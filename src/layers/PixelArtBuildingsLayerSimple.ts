import maplibregl from 'maplibre-gl';
import earcut from 'earcut';
import { classifyRings } from '@maplibre/maplibre-gl-style-spec';

const MAPLIBRE_EXTENT = 8192;

import vertexSource from '../shaders/pixel_buildings.vert.glsl?raw';
import fragmentSource from '../shaders/pixel_buildings.frag.glsl?raw';

const DEFAULT_HEIGHT_KEYS = ['render_height', 'height', 'loft_height'];
const DEFAULT_MIN_HEIGHT_KEYS = ['render_min_height', 'min_height', 'base_height'];

interface PixelArtLayerOptions {
  id?: string;
  source?: string;
  sourceLayer?: string;
  heightProperty?: string | string[];
  minHeightProperty?: string | string[];
  colorProperty?: string;
  hide3dProperty?: string;
}

interface TileMesh {
  key: string;
  tileID: any;
  count: number;
  vertexBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  typeBuffer: WebGLBuffer;
}

interface TileMeshStaging {
  key: string;
  tileID: any;
  vertices: number[];
  normals: number[];
  types: number[];
}

export class PixelArtBuildingsLayerSimple {
  id: string;
  type: 'custom';
  renderingMode: '3d';
  source: string;
  sourceLayer: string;
  heightPropertyKeys: string[];
  minHeightPropertyKeys: string[];
  colorProperty: string;
  hide3dProperty: string;

  map?: maplibregl.Map;
  program?: WebGLProgram;
  aPos?: number;
  aNormal?: number;
  aType?: number;
  uMatrix?: WebGLUniformLocation | null;
  uLightDir?: WebGLUniformLocation | null;

  vertexCount = 0;
  needsUpdate = true;
  tileMeshes: Map<string, TileMesh> = new Map();

  private handleSourceData = (e: any) => {
    if (e.sourceId === this.source) {
      this.needsUpdate = true;
      if (this.map) {
        this.map.triggerRepaint();
      }
    }
  };

  constructor(options: PixelArtLayerOptions = {}) {
    this.id = options.id || 'pixel-art-buildings';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.source = options.source || 'openmaptiles';
    this.sourceLayer = options.sourceLayer || 'building';
    this.heightPropertyKeys = this.normalizePropertyKeys(options.heightProperty, DEFAULT_HEIGHT_KEYS);
    this.minHeightPropertyKeys = this.normalizePropertyKeys(options.minHeightProperty, DEFAULT_MIN_HEIGHT_KEYS);
    this.colorProperty = options.colorProperty || 'building';
    this.hide3dProperty = options.hide3dProperty || 'hide_3d';
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    this.map = map;

    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) {
      throw new Error('Failed to create shader program');
    }
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) || 'Unknown error';
      throw new Error(`Failed to link program: ${info}`);
    }

    this.program = program;
    this.aPos = gl.getAttribLocation(program, 'a_position');
    this.aNormal = gl.getAttribLocation(program, 'a_normal');
    this.aType = gl.getAttribLocation(program, 'a_type');
    this.uMatrix = gl.getUniformLocation(program, 'u_posMatrix');
    this.uLightDir = gl.getUniformLocation(program, 'u_lightDir');

    map.on('sourcedata', this.handleSourceData);
  }

  onRemove(map: maplibregl.Map, gl: WebGLRenderingContext) {
    map.off('sourcedata', this.handleSourceData);
    this.disposeMeshes(gl);
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = undefined;
    }
  }

  prerender(gl: WebGLRenderingContext, _matrix: any) {
    if (this.needsUpdate) {
      this.updateGeometry(gl);
    }
  }

  render(gl: WebGLRenderingContext, _matrix: any) {
    if (!this.program) return;
    if (this.needsUpdate) {
      this.updateGeometry(gl);
    }
    if (this.vertexCount === 0) return;

    gl.useProgram(this.program);

    // Light from northwest (left-top direction)
    const lightDir: [number, number, number] = [-0.6, -0.6, 1.0];
    if (this.uLightDir) {
      gl.uniform3f(this.uLightDir, lightDir[0], lightDir[1], lightDir[2]);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    gl.disable(gl.BLEND);

    for (const mesh of this.tileMeshes.values()) {
      if (!mesh.vertexBuffer || !mesh.normalBuffer || !mesh.typeBuffer) continue;
      if (this.uMatrix && this.map) {
        const posMatrix64 = (this.map as any).transform.calculatePosMatrix(mesh.tileID, false, true);
        const posMatrix = posMatrix64 instanceof Float32Array ? posMatrix64 : new Float32Array(posMatrix64);
        gl.uniformMatrix4fv(this.uMatrix, false, posMatrix);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
      gl.enableVertexAttribArray(this.aPos!);
      gl.vertexAttribPointer(this.aPos!, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
      gl.enableVertexAttribArray(this.aNormal!);
      gl.vertexAttribPointer(this.aNormal!, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.typeBuffer);
      gl.enableVertexAttribArray(this.aType!);
      gl.vertexAttribPointer(this.aType!, 1, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
  }

  private updateGeometry(gl: WebGLRenderingContext) {
    if (!this.map) return;

    const mapAny = this.map as any;
    const sourceCache = mapAny?.style?.sourceCaches?.[this.source];
    if (!sourceCache || typeof sourceCache.getRenderableIds !== 'function') {
      console.warn('Source cache unavailable for', this.source);
      return;
    }

    const renderableIds: string[] = sourceCache.getRenderableIds();
    (window as any).firstBuildingSample = '';
    if (!renderableIds.length) {
      return;
    }

    const newMeshes = new Map<string, TileMeshStaging>();

    let processedCount = 0;
    let skippedHide3d = 0;
    let skippedNonPolygon = 0;
    let skippedNoGeometry = 0;
    let totalFeatures = 0;
    let pendingTiles = 0;
    let missingLayers = 0;

    for (const id of renderableIds) {
      const tile = sourceCache._tiles?.[id];
      if (!tile) {
        pendingTiles++;
        continue;
      }
      if (tile.state !== 'loaded' && tile.state !== 'reloading' && tile.state !== 'expired') {
        pendingTiles++;
        continue;
      }

      const featureIndex = tile.latestFeatureIndex;
      if (!featureIndex || typeof featureIndex.loadVTLayers !== 'function') {
        pendingTiles++;
        continue;
      }

      const vtLayers = featureIndex.loadVTLayers();
      const vtLayer = vtLayers && (vtLayers[this.sourceLayer] || vtLayers._geojsonTileLayer);
      if (!vtLayer) {
        missingLayers++;
        continue;
      }

      const extent: number = vtLayer.extent || 4096;
      const tileID = tile.tileID;
      const transform = (this.map as any).transform;
      const zoom = transform.zoom as number;
      const scaleFactor = MAPLIBRE_EXTENT / extent;
      const tileIDClone = typeof tileID.clone === 'function' ? tileID.clone() : tileID;
      const tileKey = tileID.key;
      const pixelsPerMeter = transform.pixelsPerMeter as number;
      const tileUnitsPerPixel = MAPLIBRE_EXTENT / (tile.tileSize * Math.pow(2, zoom - tileID.overscaledZ));
      const metersToTileUnits = pixelsPerMeter * tileUnitsPerPixel;

      const existing = newMeshes.get(tileKey);
      const staging: TileMeshStaging = existing || {
        key: tileKey,
        tileID: tileIDClone,
        vertices: [],
        normals: [],
        types: []
      };
      if (!existing) {
        newMeshes.set(tileKey, staging);
      }

      for (let i = 0; i < vtLayer.length; i++) {
        const vectorFeature = vtLayer.feature(i);
        totalFeatures++;

        if (vectorFeature.type !== 3) {
          skippedNonPolygon++;
          continue;
        }

        const properties = vectorFeature.properties || {};
        if (properties[this.hide3dProperty] === true || properties[this.hide3dProperty] === 1) {
          skippedHide3d++;
          continue;
        }

        const geometry = vectorFeature.loadGeometry();
        if (!geometry || geometry.length === 0) {
          skippedNoGeometry++;
          continue;
        }

        const heights = this.getHeights(properties);
        const buildingType = this.classifyBuilding(properties);
        const polygons = classifyRings(geometry, 500);

        let polygonAdded = false;

        for (const polygon of polygons) {
          const groundRings: [number, number, number][][] = [];
          const topRings: [number, number, number][][] = [];

          for (const ring of polygon) {
            if (!ring || ring.length < 3) continue;

            const groundRing: [number, number, number][] = [];
            const topRing: [number, number, number][] = [];

            for (const point of ring) {
              const scaledX = point.x * scaleFactor;
              const scaledY = point.y * scaleFactor;
              // Use meters directly for Z - MapLibre's projection matrix expects this!
              const baseZ = heights.base;
              const topZ = heights.top;

              groundRing.push([scaledX, scaledY, baseZ]);
              topRing.push([scaledX, scaledY, topZ]);
            }

            if (groundRing.length >= 3) {
              this.removeDuplicateEndpoint(groundRing, topRing);
              if (groundRing.length >= 3) {
                groundRings.push(groundRing);
                topRings.push(topRing);
              }
            }
          }

          if (!groundRings.length) continue;

          const beforeVertices = staging.vertices.length;
          this.extrudePolygonWithHoles(groundRings, topRings, buildingType, staging.vertices, staging.normals, staging.types);

          if (staging.vertices.length === beforeVertices) {
            continue;
          }

          if (!polygonAdded) {
            polygonAdded = true;
          }

          if (processedCount === 0) {
            const debug = this.buildFirstPolygonDebug(groundRings, heights, staging.vertices, beforeVertices);
            (window as any).firstBuildingSample = debug;
          }
        }

        if (polygonAdded) {
          processedCount++;
        }
      }
    }

    const totalVertexCount = Array.from(newMeshes.values()).reduce((sum, mesh) => sum + mesh.vertices.length / 3, 0);

    const debugLines = [
      `Processed: ${processedCount} buildings`,
      `Skipped: ${skippedNonPolygon} non-polygons, ${skippedHide3d} hide_3d, ${skippedNoGeometry} empty`,
      `Renderable tiles: ${renderableIds.length}, pending=${pendingTiles}, missingLayers=${missingLayers}`,
      `Total features: ${totalFeatures}`,
      `Total vertices: ${totalVertexCount}`,
      (window as any).firstBuildingSample || ''
    ];
    (window as any).buildingDebugInfo = debugLines.join('\n');

    if (totalVertexCount === 0) {
      this.disposeMeshes(gl);
      this.vertexCount = 0;
      (window as any).pixelBuildingVertexCount = 0;
      this.needsUpdate = false;
      return;
    }

    const updatedMeshes = new Map<string, TileMesh>();
    let accumulated = 0;

    for (const staging of newMeshes.values()) {
      const vertices = new Float32Array(staging.vertices);
      const normals = new Float32Array(staging.normals);
      const types = new Float32Array(staging.types);
      const count = vertices.length / 3;
      accumulated += count;

      const previous = this.tileMeshes.get(staging.key);

      const vertexBuffer = previous?.vertexBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const normalBuffer = previous?.normalBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

      const typeBuffer = previous?.typeBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, typeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, types, gl.STATIC_DRAW);

      updatedMeshes.set(staging.key, {
        key: staging.key,
        tileID: staging.tileID,
        count,
        vertexBuffer,
        normalBuffer,
        typeBuffer
      });
    }

    for (const [key, mesh] of this.tileMeshes) {
      if (!updatedMeshes.has(key)) {
        if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
        if (mesh.typeBuffer) gl.deleteBuffer(mesh.typeBuffer);
      }
    }

    this.tileMeshes = updatedMeshes;
    this.vertexCount = accumulated;
    (window as any).pixelBuildingVertexCount = this.vertexCount;
    this.needsUpdate = false;
  }


  private extrudePolygonWithHoles(
    groundRings: [number, number, number][][],
    topRings: [number, number, number][][],
    buildingType: number,
    vertices: number[],
    normals: number[],
    types: number[]
  ) {
    const flatCoords: number[] = [];
    const holeIndices: number[] = [];
    const flatVertices: [number, number, number][] = [];

    for (let r = 0; r < topRings.length; r++) {
      const ring = topRings[r];
      if (ring.length < 3) continue;
      if (r > 0) {
        holeIndices.push(flatCoords.length / 2);
      }
      for (const vertex of ring) {
        flatCoords.push(vertex[0], vertex[1]);
        flatVertices.push(vertex);
      }
    }

    const indices = earcut(flatCoords, holeIndices);

    for (let i = 0; i < indices.length; i += 3) {
      const v0 = flatVertices[indices[i]];
      const v1 = flatVertices[indices[i + 1]];
      const v2 = flatVertices[indices[i + 2]];

      vertices.push(v0[0], v0[1], v0[2], v2[0], v2[1], v2[2], v1[0], v1[1], v1[2]);
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
      types.push(buildingType, buildingType, buildingType);
    }

    for (let r = 0; r < groundRings.length; r++) {
      const groundRing = groundRings[r];
      const topRing = topRings[r];
      const ringLength = Math.min(groundRing.length, topRing.length);
      if (ringLength < 2) continue;

      for (let i = 0; i < ringLength; i++) {
        const next = (i + 1) % ringLength;
        const p1 = groundRing[i];
        const p2 = groundRing[next];
        const t1 = topRing[i];
        const t2 = topRing[next];

        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.hypot(dx, dy);
        if (len === 0) continue;
        const nx = -dy / len;
        const ny = dx / len;

        vertices.push(p1[0], p1[1], p1[2], t1[0], t1[1], t1[2], t2[0], t2[1], t2[2]);
        normals.push(nx, ny, 0, nx, ny, 0, nx, ny, 0);
        types.push(buildingType, buildingType, buildingType);

        vertices.push(p1[0], p1[1], p1[2], t2[0], t2[1], t2[2], p2[0], p2[1], p2[2]);
        normals.push(nx, ny, 0, nx, ny, 0, nx, ny, 0);
        types.push(buildingType, buildingType, buildingType);
      }
    }
  }

  private getHeights(props: Record<string, any>): { base: number; top: number } {
    const baseValue = this.resolveProperty(props, this.minHeightPropertyKeys);
    const topValue = this.resolveProperty(props, this.heightPropertyKeys);

    const base = Number(baseValue ?? 0) || 0;
    let top = Number(topValue);
    if (!Number.isFinite(top)) {
      top = base + 10;
    }
    if (top <= base) {
      top = base + 1;
    }
    return { base, top };
  }

  private classifyBuilding(props: Record<string, any>): number {
    const building = (props[this.colorProperty] || '').toString();
    if (building === 'cathedral' || building === 'church') return 0;
    if (building === 'industrial' || building === 'warehouse') return 1;
    return 2;
  }

  private buildFirstPolygonDebug(
    groundRings: [number, number, number][][],
    heights: { base: number; top: number },
    vertices: number[],
    startIndex: number
  ): string {
    if (!groundRings.length || !groundRings[0].length) {
      return '';
    }

    const basePoint = groundRings[0][0];
    const v0 = `[${vertices[startIndex].toFixed(2)}, ${vertices[startIndex + 1].toFixed(2)}, ${vertices[startIndex + 2].toFixed(2)}]`;
    const v1 = `[${vertices[startIndex + 3].toFixed(2)}, ${vertices[startIndex + 4].toFixed(2)}, ${vertices[startIndex + 5].toFixed(2)}]`;
    const v2 = `[${vertices[startIndex + 6].toFixed(2)}, ${vertices[startIndex + 7].toFixed(2)}, ${vertices[startIndex + 8].toFixed(2)}]`;

    return `First building: height=${(heights.top - heights.base).toFixed(2)}m\nSample tile coord: [${basePoint[0].toFixed(1)}, ${basePoint[1].toFixed(1)}]\nFirst 3 verts: ${v0}, ${v1}, ${v2}`;
  }

  private removeDuplicateEndpoint(ground: [number, number, number][], top: [number, number, number][]) {
    if (ground.length < 2) return;
    const [fx, fy] = ground[0];
    const [lx, ly] = ground[ground.length - 1];
    if (Math.abs(fx - lx) < 1e-6 && Math.abs(fy - ly) < 1e-6) {
      ground.pop();
      top.pop();
    }
  }

  private disposeMeshes(gl: WebGLRenderingContext) {
    for (const mesh of this.tileMeshes.values()) {
      if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
      if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
      if (mesh.typeBuffer) gl.deleteBuffer(mesh.typeBuffer);
    }
    this.tileMeshes.clear();
  }

  private normalizePropertyKeys(value: string | string[] | undefined, fallback: string[]): string[] {
    if (!value) return fallback;
    return Array.isArray(value) ? value : [value];
  }

  private resolveProperty(props: Record<string, any>, keys: string[]): any {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(props, key) && props[key] !== undefined && props[key] !== null) {
        return props[key];
      }
    }
    return undefined;
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) {
      throw new Error('Failed to create shader');
    }
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) || 'Unknown error';
      throw new Error(`Failed to compile shader: ${info}`);
    }
    return shader;
  }
}
