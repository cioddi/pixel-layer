import type maplibregl from 'maplibre-gl';
import Point from '@mapbox/point-geometry';
import { classifyRings } from '@maplibre/maplibre-gl-style-spec';

import { getCanonicalTileID, loadNormalizedGeometry } from '../utils/vectorTile';
import { getFillGranularity, subdividePolygon } from '../utils/subdivision';

const MAPLIBRE_EXTENT = 8192;

import vertexSource from '../shaders/pixel_parks.vert.glsl?raw';
import fragmentSource from '../shaders/pixel_parks.frag.glsl?raw';

export type ParkClassifyFn = (classValue: string, feature: any) => number;
export type ParkFilterFn = (classValue: string, feature: any) => boolean;

export interface PixelArtParksLayerOptions {
  id?: string;
  source?: string;
  sourceLayer?: string;
  classProperty?: string;
  classify?: ParkClassifyFn;
  filter?: ParkFilterFn;
  enableTrees?: boolean;
}

interface ParkMesh {
  key: string;
  tileID: any;
  count: number;
  vertexBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  parkTypeBuffer: WebGLBuffer;
}

interface ParkMeshStaging {
  key: string;
  tileID: any;
  vertices: number[];
  normals: number[];
  parkTypes: number[];
}

export class PixelArtParksLayer {
  id: string;
  type: 'custom';
  renderingMode: '3d';
  source: string;
  sourceLayer: string;
  classProperty: string;
  classifyFn: ParkClassifyFn;
  filterFn: ParkFilterFn;

  map?: maplibregl.Map;
  program?: WebGLProgram;
  aPos?: number;
  aNormal?: number;
  aParkType?: number;
  uMatrix?: WebGLUniformLocation | null;
  uZoom?: WebGLUniformLocation | null;

  vertexCount = 0;
  needsUpdate = true;
  parkMeshes: Map<string, ParkMesh> = new Map();
  enableTrees: boolean;

  private handleSourceData = (e: any) => {
    if (e.sourceId === this.source) {
      this.needsUpdate = true;
      if (this.map) {
        this.map.triggerRepaint();
      }
    }
  };

  constructor(options: PixelArtParksLayerOptions = {}) {
    this.id = options.id || 'pixel-art-parks';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.source = options.source || 'openmaptiles';
    this.sourceLayer = options.sourceLayer || 'park';
    this.classProperty = options.classProperty || 'class';
    this.classifyFn = options.classify || PixelArtParksLayer.defaultClassify;
    this.filterFn = options.filter || PixelArtParksLayer.defaultFilter;
    this.enableTrees = options.enableTrees ?? false;
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
    this.aParkType = gl.getAttribLocation(program, 'a_parkType');
    this.uMatrix = gl.getUniformLocation(program, 'u_posMatrix');
    this.uZoom = gl.getUniformLocation(program, 'u_zoom');

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

    if (this.needsUpdate) {
      this.updateGeometry(gl);
    }
    if (this.vertexCount === 0) return;

    gl.useProgram(this.program);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false); // Don't write to depth buffer - draw order determines visibility
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    for (const mesh of this.parkMeshes.values()) {
      if (!mesh.vertexBuffer) continue;
      if (this.uMatrix && this.map) {
        const posMatrix64 = (this.map as any).transform.calculatePosMatrix(mesh.tileID, false, true);
        const posMatrix = posMatrix64 instanceof Float32Array ? posMatrix64 : new Float32Array(posMatrix64);
        gl.uniformMatrix4fv(this.uMatrix, false, posMatrix);
        if (this.uZoom) {
          gl.uniform1f(this.uZoom, this.map.getZoom());
        }
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vertexBuffer);
      gl.enableVertexAttribArray(this.aPos!);
      gl.vertexAttribPointer(this.aPos!, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normalBuffer);
      gl.enableVertexAttribArray(this.aNormal!);
      gl.vertexAttribPointer(this.aNormal!, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.parkTypeBuffer);
      gl.enableVertexAttribArray(this.aParkType!);
      gl.vertexAttribPointer(this.aParkType!, 1, gl.FLOAT, false, 0, 0);

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

    const newMeshes = new Map<string, ParkMeshStaging>();
    let processedCount = 0;

    for (const id of renderableIds) {
      const tile = sourceCache._tiles?.[id];
      if (!tile || (tile.state !== 'loaded' && tile.state !== 'reloading')) continue;

      const featureIndex = tile.latestFeatureIndex;
      if (!featureIndex || typeof featureIndex.loadVTLayers !== 'function') continue;

      const vtLayers = featureIndex.loadVTLayers();
      const vtLayer = vtLayers?.[this.sourceLayer];
      if (!vtLayer) continue;

      const tileID = tile.tileID;
      const canonical = getCanonicalTileID(tileID);
      const granularity = getFillGranularity(canonical.z);
      const tileIDClone = typeof tileID.clone === 'function' ? tileID.clone() : tileID;
      const tileKey = tileID.key;

      const staging: ParkMeshStaging = newMeshes.get(tileKey) || {
        key: tileKey,
        tileID: tileIDClone,
        vertices: [],
        normals: [],
        parkTypes: []
      };
      if (!newMeshes.has(tileKey)) {
        newMeshes.set(tileKey, staging);
      }

      for (let i = 0; i < vtLayer.length; i++) {
        const feature = vtLayer.feature(i);
        if (feature.type !== 3) continue; // Only polygons

        const properties = feature.properties || {};
        const classValueRaw = properties[this.classProperty];
        const classValue = classValueRaw == null ? '' : String(classValueRaw);
        if (!this.filterFn(classValue, feature)) continue;

        const parkType = this.sanitizeClassifyResult(
          this.classifyFn(classValue, feature)
        );

        const geometry = loadNormalizedGeometry(feature);
        if (!geometry || geometry.length === 0) continue;

        this.processGeometry(geometry, parkType, staging, canonical, granularity);
        processedCount++;
      }
    }

    const totalVertexCount = Array.from(newMeshes.values()).reduce((sum, mesh) => sum + mesh.vertices.length / 3, 0);

    if (totalVertexCount === 0) {
      this.disposeMeshes(gl);
      this.vertexCount = 0;
      this.needsUpdate = false;
      return;
    }

    const updatedMeshes = new Map<string, ParkMesh>();
    let accumulated = 0;

    for (const staging of newMeshes.values()) {
      const vertices = new Float32Array(staging.vertices);
      const normals = new Float32Array(staging.normals);
      const parkTypes = new Float32Array(staging.parkTypes);
      const count = vertices.length / 3;
      accumulated += count;

      const previous = this.parkMeshes.get(staging.key);

      const vertexBuffer = previous?.vertexBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const normalBuffer = previous?.normalBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

      const parkTypeBuffer = previous?.parkTypeBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, parkTypeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, parkTypes, gl.STATIC_DRAW);

      updatedMeshes.set(staging.key, {
        key: staging.key,
        tileID: staging.tileID,
        count,
        vertexBuffer,
        normalBuffer,
        parkTypeBuffer
      });
    }

    for (const [key, mesh] of this.parkMeshes) {
      if (!updatedMeshes.has(key)) {
        if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
        if (mesh.parkTypeBuffer) gl.deleteBuffer(mesh.parkTypeBuffer);
      }
    }

    this.parkMeshes = updatedMeshes;
    this.vertexCount = accumulated;
    this.needsUpdate = false;

    console.log(`Loaded ${processedCount} park features, ${this.vertexCount} vertices`);
  }

  private sanitizeClassifyResult(value: number): number {
    return Number.isFinite(value) ? value : 2;
  }

  private static defaultFilter(parkClass: string): boolean {
    // Accept all valid park features - parks should not be filtered by default
    // This helps avoid rendering issues at low zoom levels
    return true;
  }

  private static defaultClassify(parkClass: string): number {
    const normalized = parkClass.toLowerCase();
    if (normalized.includes('national') || normalized.includes('nature')) return 0; // Nature reserve
    if (normalized.includes('protected')) return 1; // Protected area
    return 2; // Regular park
  }

  private processGeometry(
    geometry: Array<Array<{ x: number; y: number }>>,
    parkType: number,
    staging: ParkMeshStaging,
    canonical: { z: number; x: number; y: number },
    granularity: number
  ) {
    const z = 0.5; // Same z as all ground layers - draw order determines visibility
    const polygons = classifyRings(geometry, 500);

    for (const polygon of polygons) {
      if (!polygon.length) continue;

      const polygonPoints = polygon.map((ring) => ring.map(({ x, y }) => new Point(x, y)));
      const subdivided = subdividePolygon(polygonPoints, canonical, granularity, false);
      const verts = subdivided.verticesFlattened;
      const indices = subdivided.indicesTriangles;

      for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i] * 2;
        const i1 = indices[i + 1] * 2;
        const i2 = indices[i + 2] * 2;

        staging.vertices.push(
          verts[i0], verts[i0 + 1], z,
          verts[i1], verts[i1 + 1], z,
          verts[i2], verts[i2 + 1], z
        );
        staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
        staging.parkTypes.push(parkType, parkType, parkType);
      }

      const exterior = polygon[0];
      if (this.enableTrees && exterior && exterior.length && this.map && this.map.getZoom() >= 12) {
        this.addTrees(exterior, staging);
      }
    }
  }

  private addTrees(
    ring: Array<{ x: number; y: number }>,
    staging: ParkMeshStaging
  ) {
    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of ring) {
      const x = point.x;
      const y = point.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const area = width * height;

    if (area < 2000) return;

    const zoom = this.map?.getZoom() ?? 0;
    if (zoom < 12) return;

    if (width >= MAPLIBRE_EXTENT || height >= MAPLIBRE_EXTENT) return;

    const maxArea = MAPLIBRE_EXTENT * MAPLIBRE_EXTENT * 0.1;
    if (area > maxArea) return;

    // Tree spacing based on park size
    const spacing = 80; // Units between tree grid points
    const numX = Math.floor(width / spacing);
    const numY = Math.floor(height / spacing);

    // Limit total trees for performance
    const maxTrees = 50;
    let treeCount = 0;

    for (let ix = 0; ix < numX && treeCount < maxTrees; ix++) {
      for (let iy = 0; iy < numY && treeCount < maxTrees; iy++) {
        const gridX = minX + (ix + 0.5) * spacing;
        const gridY = minY + (iy + 0.5) * spacing;

        // Use hash to determine if tree should be placed here
        const hash = this.hash2(gridX, gridY);
        if (hash < 0.3) continue; // 30% tree density

        // Check if point is inside polygon
        if (!this.pointInPolygon(gridX, gridY, ring)) continue;

        // Add some variation to position
        const offsetX = (hash * 2 - 1) * spacing * 0.3;
        const offsetY = (this.hash2(gridX + 100, gridY) * 2 - 1) * spacing * 0.3;
        const treeX = gridX + offsetX;
        const treeY = gridY + offsetY;

        // Tree height variation
        const heightHash = this.hash2(treeX, treeY + 50);
        const treeHeight = 8 + heightHash * 8; // 8-16 meters

        this.addTree(treeX, treeY, treeHeight, staging);
        treeCount++;
      }
    }
  }

  private addTree(
    x: number,
    y: number,
    height: number,
    staging: ParkMeshStaging
  ) {
    const groundZ = 0.5;
    const trunkHeight = height * 0.4;
    const trunkRadius = 1.5;
    const foliageRadius = 4;
    const foliageHeight = height * 0.6;

    // Trunk (simple box)
    const tx0 = x - trunkRadius;
    const tx1 = x + trunkRadius;
    const ty0 = y - trunkRadius;
    const ty1 = y + trunkRadius;
    const tz0 = groundZ;
    const tz1 = groundZ + trunkHeight;

    // Trunk sides (4 quads) - brown trunk, type -1
    const trunkType = -1; // Special type for trunk

    // Front face (facing -Y)
    staging.vertices.push(tx0, ty0, tz0, tx1, ty0, tz1, tx1, ty0, tz0);
    staging.vertices.push(tx0, ty0, tz0, tx0, ty0, tz1, tx1, ty0, tz1);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.parkTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Back face (facing +Y)
    staging.vertices.push(tx0, ty1, tz0, tx1, ty1, tz0, tx1, ty1, tz1);
    staging.vertices.push(tx0, ty1, tz0, tx1, ty1, tz1, tx0, ty1, tz1);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.parkTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Left face (facing -X)
    staging.vertices.push(tx0, ty0, tz0, tx0, ty1, tz0, tx0, ty1, tz1);
    staging.vertices.push(tx0, ty0, tz0, tx0, ty1, tz1, tx0, ty0, tz1);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.parkTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Right face (facing +X)
    staging.vertices.push(tx1, ty0, tz0, tx1, ty0, tz1, tx1, ty1, tz1);
    staging.vertices.push(tx1, ty0, tz0, tx1, ty1, tz1, tx1, ty1, tz0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.parkTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Foliage (simple box at top) - green foliage, type -2
    const fx0 = x - foliageRadius;
    const fx1 = x + foliageRadius;
    const fy0 = y - foliageRadius;
    const fy1 = y + foliageRadius;
    const fz0 = tz1;
    const fz1 = tz1 + foliageHeight;

    const foliageType = -2; // Special type for foliage

    // Foliage sides
    // Front (facing -Y)
    staging.vertices.push(fx0, fy0, fz0, fx1, fy0, fz1, fx1, fy0, fz0);
    staging.vertices.push(fx0, fy0, fz0, fx0, fy0, fz1, fx1, fy0, fz1);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.parkTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Back (facing +Y)
    staging.vertices.push(fx0, fy1, fz0, fx1, fy1, fz0, fx1, fy1, fz1);
    staging.vertices.push(fx0, fy1, fz0, fx1, fy1, fz1, fx0, fy1, fz1);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.parkTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Left (facing -X)
    staging.vertices.push(fx0, fy0, fz0, fx0, fy1, fz0, fx0, fy1, fz1);
    staging.vertices.push(fx0, fy0, fz0, fx0, fy1, fz1, fx0, fy0, fz1);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.parkTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Right (facing +X)
    staging.vertices.push(fx1, fy0, fz0, fx1, fy0, fz1, fx1, fy1, fz1);
    staging.vertices.push(fx1, fy0, fz0, fx1, fy1, fz1, fx1, fy1, fz0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.parkTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Top (facing +Z)
    staging.vertices.push(fx0, fy0, fz1, fx1, fy1, fz1, fx1, fy0, fz1);
    staging.vertices.push(fx0, fy0, fz1, fx0, fy1, fz1, fx1, fy1, fz1);
    staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    staging.parkTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);
  }

  private hash2(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  private pointInPolygon(
    px: number,
    py: number,
    ring: Array<{ x: number; y: number }>
  ): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x;
      const yi = ring[i].y;
      const xj = ring[j].x;
      const yj = ring[j].y;

      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private disposeMeshes(gl: WebGLRenderingContext) {
    for (const mesh of this.parkMeshes.values()) {
      if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
      if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
      if (mesh.parkTypeBuffer) gl.deleteBuffer(mesh.parkTypeBuffer);
    }
    this.parkMeshes.clear();
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
