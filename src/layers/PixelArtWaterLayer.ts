import type maplibregl from 'maplibre-gl';
import earcut from 'earcut';

const MAPLIBRE_EXTENT = 8192;

import vertexSource from '../shaders/pixel_water.vert.glsl?raw';
import fragmentSource from '../shaders/pixel_water.frag.glsl?raw';

export type WaterClassifyFn = (classValue: string, feature: any) => number;

export interface PixelArtWaterLayerOptions {
  id?: string;
  source?: string;
  sourceLayer?: string;
  classProperty?: string;
  classify?: WaterClassifyFn;
}

interface WaterMesh {
  key: string;
  tileID: any;
  count: number;
  vertexBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  waterTypeBuffer: WebGLBuffer;
}

interface WaterMeshStaging {
  key: string;
  tileID: any;
  vertices: number[];
  normals: number[];
  waterTypes: number[];
}

export class PixelArtWaterLayer {
  id: string;
  type: 'custom';
  renderingMode: '3d';
  source: string;
  sourceLayer: string;
  classProperty: string;
  classifyFn: WaterClassifyFn;

  map?: maplibregl.Map;
  program?: WebGLProgram;
  aPos?: number;
  aNormal?: number;
  aWaterType?: number;
  uMatrix?: WebGLUniformLocation | null;
  uTime?: WebGLUniformLocation | null;
  uZoom?: WebGLUniformLocation | null;

  vertexCount = 0;
  needsUpdate = true;
  waterMeshes: Map<string, WaterMesh> = new Map();
  startTime = Date.now();

  private handleSourceData = (e: any) => {
    if (e.sourceId === this.source) {
      this.needsUpdate = true;
      if (this.map) {
        this.map.triggerRepaint();
      }
    }
  };

  constructor(options: PixelArtWaterLayerOptions = {}) {
    this.id = options.id || 'pixel-art-water';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.source = options.source || 'openmaptiles';
    this.sourceLayer = options.sourceLayer || 'water';
    this.classProperty = options.classProperty || 'class';
    this.classifyFn = options.classify || PixelArtWaterLayer.defaultClassify;
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
    this.aWaterType = gl.getAttribLocation(program, 'a_waterType');
    this.uMatrix = gl.getUniformLocation(program, 'u_posMatrix');
    this.uTime = gl.getUniformLocation(program, 'u_time');
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
    // Trigger continuous repaint for animation
    if (this.map) {
      this.map.triggerRepaint();
    }
  }

  render(gl: WebGLRenderingContext, _matrix: any) {
    if (!this.program || !this.map) return;

    if (this.needsUpdate) {
      this.updateGeometry(gl);
    }
    if (this.vertexCount === 0) return;

    gl.useProgram(this.program);

    // Pass time uniform for animation
    if (this.uTime) {
      const time = (Date.now() - this.startTime) / 1000.0; // seconds
      gl.uniform1f(this.uTime, time);
    }

    // Pass zoom level for detail culling
    if (this.uZoom && this.map) {
      gl.uniform1f(this.uZoom, this.map.getZoom());
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true); // Write to depth buffer for proper layering
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND); // Fully opaque now

    for (const mesh of this.waterMeshes.values()) {
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

      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.waterTypeBuffer);
      gl.enableVertexAttribArray(this.aWaterType!);
      gl.vertexAttribPointer(this.aWaterType!, 1, gl.FLOAT, false, 0, 0);

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

    const newMeshes = new Map<string, WaterMeshStaging>();
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

      const staging: WaterMeshStaging = newMeshes.get(tileKey) || {
        key: tileKey,
        tileID: tileIDClone,
        vertices: [],
        normals: [],
        waterTypes: []
      };
      if (!newMeshes.has(tileKey)) {
        newMeshes.set(tileKey, staging);
      }

      for (let i = 0; i < vtLayer.length; i++) {
        const feature = vtLayer.feature(i);
        const properties = feature.properties || {};
        const classValueRaw = properties[this.classProperty];
        const classValue = classValueRaw == null ? '' : String(classValueRaw);
        const waterType = this.sanitizeClassifyResult(
          this.classifyFn(classValue, feature)
        );

        if (feature.type === 3) {
          // Polygon (lakes, oceans)
          const geometry = feature.loadGeometry();
          if (!geometry || geometry.length === 0) continue;

          this.processPolygon(geometry, waterType, scaleFactor, staging);
          processedCount++;
        }
        // Skip linestrings (rivers/streams)
      }
    }

    const totalVertexCount = Array.from(newMeshes.values()).reduce((sum, mesh) => sum + mesh.vertices.length / 3, 0);

    if (totalVertexCount === 0) {
      this.disposeMeshes(gl);
      this.vertexCount = 0;
      this.needsUpdate = false;
      return;
    }

    const updatedMeshes = new Map<string, WaterMesh>();
    let accumulated = 0;

    for (const staging of newMeshes.values()) {
      const vertices = new Float32Array(staging.vertices);
      const normals = new Float32Array(staging.normals);
      const waterTypes = new Float32Array(staging.waterTypes);
      const count = vertices.length / 3;
      accumulated += count;

      const previous = this.waterMeshes.get(staging.key);

      const vertexBuffer = previous?.vertexBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

      const normalBuffer = previous?.normalBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

      const waterTypeBuffer = previous?.waterTypeBuffer || gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, waterTypeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, waterTypes, gl.STATIC_DRAW);

      updatedMeshes.set(staging.key, {
        key: staging.key,
        tileID: staging.tileID,
        count,
        vertexBuffer,
        normalBuffer,
        waterTypeBuffer
      });
    }

    for (const [key, mesh] of this.waterMeshes) {
      if (!updatedMeshes.has(key)) {
        if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
        if (mesh.waterTypeBuffer) gl.deleteBuffer(mesh.waterTypeBuffer);
      }
    }

    this.waterMeshes = updatedMeshes;
    this.vertexCount = accumulated;
    this.needsUpdate = false;

    console.log(`Loaded ${processedCount} water features, ${this.vertexCount} vertices`);
  }

  private processPolygon(
    geometry: Array<Array<{ x: number; y: number }>>,
    waterType: number,
    scaleFactor: number,
    staging: WaterMeshStaging
  ) {
    const z = 0.3; // Just above ground, below roads

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
      staging.waterTypes.push(waterType, waterType, waterType);
    }
  }
  private disposeMeshes(gl: WebGLRenderingContext) {
    for (const mesh of this.waterMeshes.values()) {
      if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
      if (mesh.normalBuffer) gl.deleteBuffer(mesh.normalBuffer);
      if (mesh.waterTypeBuffer) gl.deleteBuffer(mesh.waterTypeBuffer);
    }
    this.waterMeshes.clear();
  }

  private sanitizeClassifyResult(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  private static defaultClassify(waterClass: string): number {
    const normalized = waterClass.toLowerCase();
    return normalized === 'river' || normalized === 'stream' ? 1 : 0;
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
