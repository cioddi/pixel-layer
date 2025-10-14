import type maplibregl from 'maplibre-gl';
import earcut from 'earcut';

const MAPLIBRE_EXTENT = 8192;

import vertexSource from '../shaders/pixel_landuse.vert.glsl?raw';
import fragmentSource from '../shaders/pixel_landuse.frag.glsl?raw';

export type LanduseClassifyFn = (classValue: string, feature: any) => number;
export type LanduseFilterFn = (classValue: string, feature: any) => boolean;

export interface PixelArtLanduseLayerOptions {
  id?: string;
  source?: string;
  sourceLayer?: string;
  classProperty?: string;
  classify?: LanduseClassifyFn;
  filter?: LanduseFilterFn;
}

interface LanduseMesh {
  key: string;
  tileID: any;
  count: number;
  vertexBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  landuseTypeBuffer: WebGLBuffer;
}

interface LanduseMeshStaging {
  key: string;
  tileID: any;
  vertices: number[];
  normals: number[];
  landuseTypes: number[];
}

export class PixelArtLanduseLayer {
  id: string;
  type: 'custom';
  renderingMode: '3d';
  source: string;
  sourceLayer: string;
  classProperty: string;
  classifyFn: LanduseClassifyFn;
  filterFn: LanduseFilterFn;

  map?: maplibregl.Map;
  program?: WebGLProgram;
  aPos?: number;
  aNormal?: number;
  aLanduseType?: number;
  uMatrix?: WebGLUniformLocation | null;

  vertexCount = 0;
  needsUpdate = true;
  landuseMeshes: Map<string, LanduseMesh> = new Map();

  private handleSourceData = (e: any) => {
    if (e.sourceId === this.source) {
      this.needsUpdate = true;
      if (this.map) {
        this.map.triggerRepaint();
      }
    }
  };

  constructor(options: PixelArtLanduseLayerOptions = {}) {
    this.id = options.id || 'pixel-art-landuse';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.source = options.source || 'openmaptiles';
    this.sourceLayer = options.sourceLayer || 'landuse';
    this.classProperty = options.classProperty || 'class';
    this.classifyFn = options.classify || PixelArtLanduseLayer.defaultClassify;
    this.filterFn = options.filter || PixelArtLanduseLayer.defaultFilter;
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
    this.aLanduseType = gl.getAttribLocation(program, 'a_landuseType');
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

    if (this.needsUpdate) {
      this.updateGeometry(gl);
    }
    if (this.vertexCount === 0) return;

    gl.useProgram(this.program);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true); // Write to depth buffer for proper layering
    gl.disable(gl.CULL_FACE); // Disable culling - ground needs to be visible from above
    gl.disable(gl.BLEND); // Fully opaque

    for (const mesh of this.landuseMeshes.values()) {
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

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.landuseTypeBuffer);
      gl.enableVertexAttribArray(this.aLanduseType!);
      gl.vertexAttribPointer(this.aLanduseType!, 1, gl.FLOAT, false, 0, 0);

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

    const newMeshes = new Map<string, LanduseMeshStaging>();
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

      const staging: LanduseMeshStaging = newMeshes.get(tileKey) || {
        key: tileKey,
        tileID: tileIDClone,
        vertices: [],
        normals: [],
        landuseTypes: []
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

        const landuseType = this.sanitizeClassifyResult(
          this.classifyFn(classValue, feature)
        );

        const geometry = feature.loadGeometry();
        if (!geometry || geometry.length === 0) continue;

        this.processPolygon(geometry, landuseType, scaleFactor, staging);
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

    const updatedMeshes = new Map<string, LanduseMesh>();
    let accumulated = 0;

    for (const staging of newMeshes.values()) {
      const vertices = new Float32Array(staging.vertices);
      const normals = new Float32Array(staging.normals);
      const landuseTypes = new Float32Array(staging.landuseTypes);
      const count = vertices.length / 3;
      accumulated += count;

      const previous = this.landuseMeshes.get(staging.key);

      const vertexBuffer = previous?.vertexBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const normalBuffer = previous?.normalBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

      const landuseTypeBuffer = previous?.landuseTypeBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, landuseTypeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, landuseTypes, gl.STATIC_DRAW);

      updatedMeshes.set(staging.key, {
        key: staging.key,
        tileID: staging.tileID,
        count,
        vertexBuffer,
        normalBuffer,
        landuseTypeBuffer
      });
    }

    for (const [key, mesh] of this.landuseMeshes) {
      if (!updatedMeshes.has(key)) {
        if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
        if (mesh.landuseTypeBuffer) gl.deleteBuffer(mesh.landuseTypeBuffer);
      }
    }

    this.landuseMeshes = updatedMeshes;
    this.vertexCount = accumulated;
    this.needsUpdate = false;

    console.log(`Loaded ${processedCount} landuse features, ${this.vertexCount} vertices`);
  }

  private sanitizeClassifyResult(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private static defaultFilter(landuseClass: string): boolean {
    const normalized = landuseClass.toLowerCase();
    return normalized.includes('grass') ||
      normalized.includes('meadow') ||
      normalized.includes('pasture') ||
      normalized.includes('village_green') ||
      normalized.includes('recreation') ||
      normalized.includes('garden') ||
      normalized.includes('allot') ||
      normalized.includes('farmland') ||
      normalized.includes('field') ||
      normalized.includes('farm') ||
      normalized.includes('crop') ||
      normalized.includes('orchard') ||
      normalized.includes('vineyard') ||
      normalized.includes('plant_nursery');
  }

  private static defaultClassify(landuseClass: string): number {
    const normalized = landuseClass.toLowerCase();
    if (normalized.includes('orchard') || normalized.includes('vineyard') || normalized.includes('plant_nursery')) return 3;
    if (normalized.includes('farmland') || normalized.includes('field') || normalized.includes('farm') || normalized.includes('crop')) return 2;
    if (normalized.includes('garden') || normalized.includes('allot') || normalized.includes('village_green') || normalized.includes('recreation')) return 1;
    return 0;
  }

  private processPolygon(
    geometry: Array<Array<{ x: number; y: number }>>,
    landuseType: number,
    scaleFactor: number,
    staging: LanduseMeshStaging
  ) {
    const z = 0.35; // Just above water, below parks

    // Outer ring
    const outerRing = geometry[0];
    if (!outerRing || outerRing.length < 3) return;

    // Convert to flat array for earcut
    const coords: number[] = [];
    const holes: number[] = [];

    for (const point of outerRing) {
      coords.push(point.x * scaleFactor, point.y * scaleFactor);
    }

    // Add holes if present
    for (let i = 1; i < geometry.length; i++) {
      holes.push(coords.length / 2);
      for (const point of geometry[i]) {
        coords.push(point.x * scaleFactor, point.y * scaleFactor);
      }
    }

    // Triangulate
    const indices = earcut(coords, holes.length > 0 ? holes : undefined, 2);

    // Add triangles
    for (let i = 0; i < indices.length; i += 3) {
      const i0 = indices[i] * 2;
      const i1 = indices[i + 1] * 2;
      const i2 = indices[i + 2] * 2;

      staging.vertices.push(
        coords[i0], coords[i0 + 1], z,
        coords[i1], coords[i1 + 1], z,
        coords[i2], coords[i2 + 1], z
      );
      staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
      staging.landuseTypes.push(landuseType, landuseType, landuseType);
    }

    // Add trees for appropriate landuse types (only at higher zoom levels)
    if (this.map && this.map.getZoom() >= 12) {
      this.addTrees(outerRing, scaleFactor, landuseType, staging);
    }
  }

  private addTrees(
    ring: Array<{ x: number; y: number }>,
    scaleFactor: number,
    landuseType: number,
    staging: LanduseMeshStaging
  ) {
    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of ring) {
      const x = point.x * scaleFactor;
      const y = point.y * scaleFactor;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const width = maxX - minX;
    const height = maxY - minY;
    const area = width * height;

    // Skip very small areas
    if (area < 1500) return;

    // Tree spacing, density, and variety based on landuse type
    let spacing = 60;
    let density = 0.4;
    let maxTrees = 40;
    let treeVariety = 0; // 0=standard, 1=fruit trees, 2=wild/mixed

    if (landuseType === 3) {
      // Orchards - more organized grid, higher density, fruit trees
      spacing = 50;
      density = 0.6;
      maxTrees = 60;
      treeVariety = 1;
    } else if (landuseType === 1) {
      // Gardens - scattered trees, mixed types
      spacing = 70;
      density = 0.25;
      maxTrees = 20;
      treeVariety = 2;
    } else if (landuseType === 0) {
      // Meadows - very sparse, wild trees
      spacing = 90;
      density = 0.15;
      maxTrees = 15;
      treeVariety = 2;
    } else if (landuseType === 2) {
      // Farmland - very sparse, edge trees
      spacing = 100;
      density = 0.08;
      maxTrees = 10;
      treeVariety = 2;
    } else {
      return; // No trees for other types
    }

    const numX = Math.floor(width / spacing);
    const numY = Math.floor(height / spacing);

    let treeCount = 0;

    for (let ix = 0; ix < numX && treeCount < maxTrees; ix++) {
      for (let iy = 0; iy < numY && treeCount < maxTrees; iy++) {
        const gridX = minX + (ix + 0.5) * spacing;
        const gridY = minY + (iy + 0.5) * spacing;

        // Use hash to determine if tree should be placed here
        const hash = this.hash2(gridX, gridY);
        if (hash < density) continue;

        // Check if point is inside polygon
        if (!this.pointInPolygon(gridX, gridY, ring, scaleFactor)) continue;

        // Add some variation to position
        const offsetX = (hash * 2 - 1) * spacing * 0.25;
        const offsetY = (this.hash2(gridX + 100, gridY) * 2 - 1) * spacing * 0.25;
        const treeX = gridX + offsetX;
        const treeY = gridY + offsetY;

        // Tree height and type variation
        const heightHash = this.hash2(treeX, treeY + 50);
        const typeHash = this.hash2(treeX + 200, treeY);
        let treeHeight: number;
        let treeType: number;

        if (treeVariety === 1) {
          // Fruit trees - smaller, more uniform
          treeHeight = 5 + heightHash * 4; // 5-9 meters
          treeType = -1; // Standard trunk/foliage
        } else if (treeVariety === 2) {
          // Wild/mixed - varied sizes and types
          treeHeight = 7 + heightHash * 10; // 7-17 meters
          // Mix of tree types
          if (typeHash < 0.3) {
            treeType = -3; // Dark green conifer-style
          } else if (typeHash < 0.6) {
            treeType = -4; // Light green deciduous
          } else {
            treeType = -1; // Standard green
          }
        } else {
          // Standard
          treeHeight = 6 + heightHash * 8; // 6-14 meters
          treeType = -1;
        }

        this.addTree(treeX, treeY, treeHeight, treeType, staging);
        treeCount++;
      }
    }
  }

  private addTree(
    x: number,
    y: number,
    height: number,
    treeType: number,
    staging: LanduseMeshStaging
  ) {
    const groundZ = 0.35;
    const trunkHeight = height * 0.4;
    const trunkRadius = 1.5;
    const foliageRadius = 3.5;
    const foliageHeight = height * 0.6;

    // Trunk
    const tx0 = x - trunkRadius;
    const tx1 = x + trunkRadius;
    const ty0 = y - trunkRadius;
    const ty1 = y + trunkRadius;
    const tz0 = groundZ;
    const tz1 = groundZ + trunkHeight;

    const trunkType = -1; // Special type for trunk (always same)

    // Trunk faces (CCW winding)
    // Front
    staging.vertices.push(tx0, ty0, tz0, tx1, ty0, tz1, tx1, ty0, tz0);
    staging.vertices.push(tx0, ty0, tz0, tx0, ty0, tz1, tx1, ty0, tz1);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.landuseTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Back
    staging.vertices.push(tx0, ty1, tz0, tx1, ty1, tz0, tx1, ty1, tz1);
    staging.vertices.push(tx0, ty1, tz0, tx1, ty1, tz1, tx0, ty1, tz1);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.landuseTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Left
    staging.vertices.push(tx0, ty0, tz0, tx0, ty1, tz0, tx0, ty1, tz1);
    staging.vertices.push(tx0, ty0, tz0, tx0, ty1, tz1, tx0, ty0, tz1);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.landuseTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Right
    staging.vertices.push(tx1, ty0, tz0, tx1, ty0, tz1, tx1, ty1, tz1);
    staging.vertices.push(tx1, ty0, tz0, tx1, ty1, tz1, tx1, ty1, tz0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.landuseTypes.push(trunkType, trunkType, trunkType, trunkType, trunkType, trunkType);

    // Foliage
    const fx0 = x - foliageRadius;
    const fx1 = x + foliageRadius;
    const fy0 = y - foliageRadius;
    const fy1 = y + foliageRadius;
    const fz0 = tz1;
    const fz1 = tz1 + foliageHeight;

    const foliageType = treeType; // Use the passed-in tree type for foliage variety

    // Foliage faces (CCW winding)
    // Front
    staging.vertices.push(fx0, fy0, fz0, fx1, fy0, fz1, fx1, fy0, fz0);
    staging.vertices.push(fx0, fy0, fz0, fx0, fy0, fz1, fx1, fy0, fz1);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
    staging.landuseTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Back
    staging.vertices.push(fx0, fy1, fz0, fx1, fy1, fz0, fx1, fy1, fz1);
    staging.vertices.push(fx0, fy1, fz0, fx1, fy1, fz1, fx0, fy1, fz1);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    staging.landuseTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Left
    staging.vertices.push(fx0, fy0, fz0, fx0, fy1, fz0, fx0, fy1, fz1);
    staging.vertices.push(fx0, fy0, fz0, fx0, fy1, fz1, fx0, fy0, fz1);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.normals.push(-1, 0, 0, -1, 0, 0, -1, 0, 0);
    staging.landuseTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Right
    staging.vertices.push(fx1, fy0, fz0, fx1, fy0, fz1, fx1, fy1, fz1);
    staging.vertices.push(fx1, fy0, fz0, fx1, fy1, fz1, fx1, fy1, fz0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.normals.push(1, 0, 0, 1, 0, 0, 1, 0, 0);
    staging.landuseTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);

    // Top
    staging.vertices.push(fx0, fy0, fz1, fx1, fy1, fz1, fx1, fy0, fz1);
    staging.vertices.push(fx0, fy0, fz1, fx0, fy1, fz1, fx1, fy1, fz1);
    staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    staging.normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    staging.landuseTypes.push(foliageType, foliageType, foliageType, foliageType, foliageType, foliageType);
  }

  private hash2(x: number, y: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }

  private pointInPolygon(
    px: number,
    py: number,
    ring: Array<{ x: number; y: number }>,
    scaleFactor: number
  ): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x * scaleFactor;
      const yi = ring[i].y * scaleFactor;
      const xj = ring[j].x * scaleFactor;
      const yj = ring[j].y * scaleFactor;

      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  private disposeMeshes(gl: WebGLRenderingContext) {
    for (const mesh of this.landuseMeshes.values()) {
      if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
      if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
      if (mesh.landuseTypeBuffer) gl.deleteBuffer(mesh.landuseTypeBuffer);
    }
    this.landuseMeshes.clear();
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
