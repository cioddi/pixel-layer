import type maplibregl from 'maplibre-gl';

const MAPLIBRE_EXTENT = 8192;

import vertexSource from '../shaders/pixel_roads.vert.glsl?raw';
import fragmentSource from '../shaders/pixel_roads.frag.glsl?raw';

export type RoadClassifyFn = (classValue: string, feature: any) => number;

export interface PixelArtRoadsLayerOptions {
  id?: string;
  source?: string;
  sourceLayer?: string;
  classProperty?: string;
  classify?: RoadClassifyFn;
}

interface RoadMesh {
  key: string;
  tileID: any;
  count: number;
  vertexBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  roadTypeBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
}

interface RoadMeshStaging {
  key: string;
  tileID: any;
  vertices: number[];
  normals: number[];
  roadTypes: number[];
  texCoords: number[];
}

export class PixelArtRoadsLayer {
  id: string;
  type: 'custom';
  renderingMode: '3d';
  source: string;
  sourceLayer: string;
  classProperty: string;
  classifyFn: RoadClassifyFn;

  map?: maplibregl.Map;
  program?: WebGLProgram;
  aPos?: number;
  aNormal?: number;
  aRoadType?: number;
  aTexCoord?: number;
  uMatrix?: WebGLUniformLocation | null;

  vertexCount = 0;
  needsUpdate = true;
  roadMeshes: Map<string, RoadMesh> = new Map();

  private handleSourceData = (e: any) => {
    if (e.sourceId === this.source) {
      this.needsUpdate = true;
      if (this.map) {
        this.map.triggerRepaint();
      }
    }
  };

  constructor(options: PixelArtRoadsLayerOptions = {}) {
    this.id = options.id || 'pixel-art-roads';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.source = options.source || 'openmaptiles';
    this.sourceLayer = options.sourceLayer || 'transportation';
    this.classProperty = options.classProperty || 'class';
    this.classifyFn = options.classify || PixelArtRoadsLayer.defaultClassify;
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
    this.aRoadType = gl.getAttribLocation(program, 'a_roadType');
    this.aTexCoord = gl.getAttribLocation(program, 'a_texCoord');
    this.uMatrix = gl.getUniformLocation(program, 'u_posMatrix');

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
    if (!this.program || !this.map) return;

    // Skip rendering at very low zoom levels for performance
    const zoom = this.map.getZoom();
    if (zoom < 4) return;

    if (this.needsUpdate) {
      this.updateGeometry(gl);
    }
    if (this.vertexCount === 0) return;

    gl.useProgram(this.program);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true); // Write to depth buffer for proper layering
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND); // Fully opaque

    for (const mesh of this.roadMeshes.values()) {
      if (!mesh.vertexBuffer) continue;
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

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.roadTypeBuffer);
      gl.enableVertexAttribArray(this.aRoadType!);
      gl.vertexAttribPointer(this.aRoadType!, 1, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.texCoordBuffer);
      gl.enableVertexAttribArray(this.aTexCoord!);
      gl.vertexAttribPointer(this.aTexCoord!, 2, gl.FLOAT, false, 0, 0);

      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
  }

  private updateGeometry(gl: WebGLRenderingContext) {
    if (!this.map) return;

    const mapAny = this.map as any;
    const sourceCache = mapAny?.style?.sourceCaches?.[this.source];
    if (!sourceCache) {
      console.warn('Source cache unavailable for', this.source);
      return;
    }

    const renderableIds: string[] = sourceCache.getRenderableIds();
    if (!renderableIds.length) {
      return;
    }

    const newMeshes = new Map<string, RoadMeshStaging>();
    let processedCount = 0;

    for (const id of renderableIds) {
      const tile = sourceCache._tiles?.[id];
      if (!tile || (tile.state !== 'loaded' && tile.state !== 'reloading')) continue;

      const featureIndex = tile.latestFeatureIndex;
      if (!featureIndex || typeof featureIndex.loadVTLayers !== 'function') continue;

      const vtLayers = featureIndex.loadVTLayers();
      const vtLayer = vtLayers?.[this.sourceLayer];
      if (!vtLayer) continue;

      const extent = vtLayer.extent || 4096;
      const tileID = tile.tileID;
      const scaleFactor = MAPLIBRE_EXTENT / extent;
      const tileIDClone = typeof tileID.clone === 'function' ? tileID.clone() : tileID;
      const tileKey = tileID.key;

      const staging: RoadMeshStaging = newMeshes.get(tileKey) || {
        key: tileKey,
        tileID: tileIDClone,
        vertices: [],
        normals: [],
        roadTypes: [],
        texCoords: []
      };
      if (!newMeshes.has(tileKey)) {
        newMeshes.set(tileKey, staging);
      }

      for (let i = 0; i < vtLayer.length; i++) {
        const feature = vtLayer.feature(i);
        if (feature.type !== 2) continue; // Only linestrings

        const properties = feature.properties || {};
        const classValueRaw = properties[this.classProperty];
        const classValue = classValueRaw == null ? '' : String(classValueRaw);
        const roadType = this.sanitizeClassifyResult(
          this.classifyFn(classValue, feature)
        );

        const geometry = feature.loadGeometry();
        if (!geometry || geometry.length === 0) continue;

        for (const line of geometry) {
          if (line.length < 2) continue;

          this.extrudeLine(line, roadType, scaleFactor, staging);
          processedCount++;
        }
      }
    }

    const totalVertexCount = Array.from(newMeshes.values()).reduce((sum, mesh) => sum + mesh.vertices.length / 3, 0);

    if (totalVertexCount === 0) {
      this.disposeMeshes(gl);
      this.vertexCount = 0;
      this.needsUpdate = false;
      return;
    }

    const updatedMeshes = new Map<string, RoadMesh>();
    let accumulated = 0;

    for (const staging of newMeshes.values()) {
      const vertices = new Float32Array(staging.vertices);
      const normals = new Float32Array(staging.normals);
      const roadTypes = new Float32Array(staging.roadTypes);
      const texCoords = new Float32Array(staging.texCoords);
      const count = vertices.length / 3;
      accumulated += count;

      const previous = this.roadMeshes.get(staging.key);

      const vertexBuffer = previous?.vertexBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const normalBuffer = previous?.normalBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

      const roadTypeBuffer = previous?.roadTypeBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, roadTypeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, roadTypes, gl.STATIC_DRAW);

      const texCoordBuffer = previous?.texCoordBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

      updatedMeshes.set(staging.key, {
        key: staging.key,
        tileID: staging.tileID,
        count,
        vertexBuffer,
        normalBuffer,
        roadTypeBuffer,
        texCoordBuffer
      });
    }

    for (const [key, mesh] of this.roadMeshes) {
      if (!updatedMeshes.has(key)) {
        if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
        if (mesh.roadTypeBuffer) gl.deleteBuffer(mesh.roadTypeBuffer);
        if (mesh.texCoordBuffer) gl.deleteBuffer(mesh.texCoordBuffer);
      }
    }

    this.roadMeshes = updatedMeshes;
    this.vertexCount = accumulated;
    this.needsUpdate = false;

    console.log(`Loaded ${processedCount} road segments, ${this.vertexCount} vertices`);
  }

  private sanitizeClassifyResult(value: number): number {
    return Number.isFinite(value) ? value : 3;
  }

  private static defaultClassify(roadClass: string): number {
    const normalized = roadClass.toLowerCase();
    if (normalized.includes('motorway') || normalized.includes('trunk')) return 0; // Highway
    if (normalized.includes('primary')) return 1; // Primary
    if (normalized.includes('secondary') || normalized.includes('tertiary')) return 2; // Secondary
    return 3; // Residential/other
  }

  private extrudeLine(
    line: Array<{ x: number; y: number }>,
    roadType: number,
    scaleFactor: number,
    staging: RoadMeshStaging
  ) {
    if (line.length < 2) return;

    // Road width based on type (even wider!)
    let width = 30.0; // meters
    if (roadType === 0) width = 60.0; // Highway - extra wide
    else if (roadType === 1) width = 45.0; // Primary - very wide
    else if (roadType === 2) width = 30.0; // Secondary
    else width = 20.0; // Residential

    const z = 0.5; // Slightly above ground to avoid z-fighting with terrain
    const halfWidth = width / 2;
    let distanceAlong = 0.0;

    // Pre-calculate all point positions and normals
    const points: Array<{ x: number; y: number; nx: number; ny: number }> = [];

    for (let i = 0; i < line.length; i++) {
      const p = line[i];
      const x = p.x * scaleFactor;
      const y = p.y * scaleFactor;

      let nx = 0, ny = 0;

      if (i === 0) {
        // First point - use direction to next point
        const next = line[i + 1];
        const dx = (next.x * scaleFactor) - x;
        const dy = (next.y * scaleFactor) - y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          nx = -dy / len;
          ny = dx / len;
        }
      } else if (i === line.length - 1) {
        // Last point - use direction from previous point
        const prev = line[i - 1];
        const dx = x - (prev.x * scaleFactor);
        const dy = y - (prev.y * scaleFactor);
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          nx = -dy / len;
          ny = dx / len;
        }
      } else {
        // Middle point - average of both directions for smooth join
        const prev = line[i - 1];
        const next = line[i + 1];

        const dx1 = x - (prev.x * scaleFactor);
        const dy1 = y - (prev.y * scaleFactor);
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);

        const dx2 = (next.x * scaleFactor) - x;
        const dy2 = (next.y * scaleFactor) - y;
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

        if (len1 > 0 && len2 > 0) {
          const nx1 = -dy1 / len1;
          const ny1 = dx1 / len1;
          const nx2 = -dy2 / len2;
          const ny2 = dx2 / len2;

          // Average and normalize
          nx = (nx1 + nx2) / 2;
          ny = (ny1 + ny2) / 2;
          const nlen = Math.sqrt(nx * nx + ny * ny);
          if (nlen > 0) {
            nx /= nlen;
            ny /= nlen;
          }
        }
      }

      points.push({ x, y, nx, ny });
    }

    // Generate quads between consecutive points
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      const len = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
      if (len === 0) continue;

      // Four corners of the road segment quad
      const x1l = p1.x + p1.nx * halfWidth;
      const y1l = p1.y + p1.ny * halfWidth;
      const x1r = p1.x - p1.nx * halfWidth;
      const y1r = p1.y - p1.ny * halfWidth;
      const x2l = p2.x + p2.nx * halfWidth;
      const y2l = p2.y + p2.ny * halfWidth;
      const x2r = p2.x - p2.nx * halfWidth;
      const y2r = p2.y - p2.ny * halfWidth;

      // Texture coordinates along the road
      const t1 = distanceAlong / width;
      const t2 = (distanceAlong + len) / width;
      distanceAlong += len;

      // First triangle
      staging.vertices.push(x1l, y1l, z, x1r, y1r, z, x2l, y2l, z);
      staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
      staging.roadTypes.push(roadType, roadType, roadType);
      staging.texCoords.push(t1, 0, t1, 1, t2, 0);

      // Second triangle
      staging.vertices.push(x1r, y1r, z, x2r, y2r, z, x2l, y2l, z);
      staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
      staging.roadTypes.push(roadType, roadType, roadType);
      staging.texCoords.push(t1, 1, t2, 1, t2, 0);
    }
  }

  private disposeMeshes(gl: WebGLRenderingContext) {
    for (const mesh of this.roadMeshes.values()) {
      if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
      if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
      if (mesh.roadTypeBuffer) gl.deleteBuffer(mesh.roadTypeBuffer);
      if (mesh.texCoordBuffer) gl.deleteBuffer(mesh.texCoordBuffer);
    }
    this.roadMeshes.clear();
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
