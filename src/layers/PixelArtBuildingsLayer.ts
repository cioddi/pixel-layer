import maplibregl from 'maplibre-gl';
import { createProgram, getLocations } from '../shaders/shaderUtils';
import { BuildingClassifier } from '../rendering/BuildingClassifier';

const vertexShaderSource = `
attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_type;

uniform mat4 u_matrix;

varying vec3 v_normal;
varying vec3 v_position;
varying float v_type;

void main() {
  v_normal = a_normal;
  v_position = a_position;
  v_type = a_type;
  gl_Position = u_matrix * vec4(a_position, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

varying vec3 v_normal;
varying vec3 v_position;
varying float v_type;

uniform vec3 u_lightDir;

void main() {
  vec3 color;
  if (v_type < 0.5) {
    color = vec3(1.0, 0.0, 0.0);  // Red for Gothic
  } else if (v_type < 1.5) {
    color = vec3(0.0, 1.0, 0.0);  // Green for Industrial
  } else {
    color = vec3(0.0, 0.0, 1.0);  // Blue for Residential
  }

  float light = max(0.5, dot(normalize(v_normal), normalize(u_lightDir)));
  gl_FragColor = vec4(color * light, 1.0);
}
`;

interface LayerOptions {
  id?: string;
  sourceLayer?: string;
  source?: string;
}

interface Building {
  footprint: number[][]; // [lng, lat]
  height: number; // raw height in meters
  type: number;
}

export class PixelArtBuildingsLayer {
  id: string;
  type: string;
  renderingMode: string;
  sourceLayer: string;
  source: string;
  buildings: Building[];
  geometryNeedsUpdate: boolean;
  map?: maplibregl.Map;
  gl?: WebGLRenderingContext;
  program?: WebGLProgram;
  locations?: Record<string, number | WebGLUniformLocation | null>;
  vertexBuffer?: WebGLBuffer;
  normalBuffer?: WebGLBuffer;
  typeBuffer?: WebGLBuffer;
  vertexCount: number;

  constructor(options: LayerOptions = {}) {
    this.id = options.id || 'pixel-art-buildings';
    this.type = 'custom';
    this.renderingMode = '3d';
    this.sourceLayer = options.sourceLayer || 'building';
    this.source = options.source || 'openmaptiles';

    this.buildings = [];
    this.geometryNeedsUpdate = false;
    this.vertexCount = 0;
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    console.log('PixelArtBuildingsLayer.onAdd called');
    this.map = map;
    this.gl = gl;

    try {
      this.program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
      console.log('Shader program created successfully');
    } catch (e) {
      console.error('Failed to create shader program:', e);
      return;
    }

    this.locations = getLocations(gl, this.program,
      ['a_position', 'a_normal', 'a_type'],
      ['u_matrix', 'u_lightDir', 'u_palette']
    );

    this.vertexBuffer = gl.createBuffer() || undefined;
    this.normalBuffer = gl.createBuffer() || undefined;
    this.typeBuffer = gl.createBuffer() || undefined;

    this.map.on('sourcedata', (e: any) => {
      if (e.isSourceLoaded && e.sourceId === this.source) {
        console.log('Source loaded:', e.sourceId);
        this.loadBuildings();
      }
    });

    this.map.on('move', () => {
      this.loadBuildings();
    });
  }

  loadBuildings() {
    if (!this.map) return;

    const features = this.map.querySourceFeatures(this.source, {
      sourceLayer: this.sourceLayer
    });

    console.log(`Found ${features.length} features from source '${this.source}', layer '${this.sourceLayer}'`);

    if (features.length === 0) return;

    this.buildings = features
      .filter(f => f.geometry.type === 'Polygon')
      .map(f => this.processFeature(f));

    console.log(`Processed ${this.buildings.length} buildings`);
    this.geometryNeedsUpdate = true;
  }

  processFeature(feature: any): Building {
    const coords = feature.geometry.coordinates[0];

    const rawHeight = feature.properties.render_height ?? feature.properties.height ?? 20;

    // Store just lng/lat
    const footprint = coords.map(([lng, lat]: [number, number]) => {
      return [lng, lat];
    });

    if (this.buildings.length === 0) {
      console.log('First building sample:', {
        'rawHeight': rawHeight,
        'sampleCoord': footprint[0]
      });
    }

    return {
      footprint,
      height: rawHeight,
      type: BuildingClassifier.classify(feature.properties)
    };
  }

  updateBuffers() {
    if (!this.gl || !this.map) return;

    const allVertices: number[] = [];
    const allNormals: number[] = [];
    const allTypes: number[] = [];

    const gl = this.gl;

    if (this.vertexBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allVertices), gl.STATIC_DRAW);
    }

    if (this.normalBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allNormals), gl.STATIC_DRAW);
    }

    if (this.typeBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.typeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(allTypes), gl.STATIC_DRAW);
    }

    this.vertexCount = allVertices.length / 3;
    this.geometryNeedsUpdate = false;
  }

  prerender(gl: WebGLRenderingContext, matrix: number[]) {
    void gl;
    void matrix;
    if (!this.program) return;
  }

  render(gl: WebGLRenderingContext, matrix: any) {
    // Debug matrix to screen
    if (this.vertexCount === 3) {  // Only when we have our test triangle
      const isArray = Array.isArray(matrix);
      const keys = (matrix && typeof matrix === 'object') ? Object.keys(matrix).join(',') : 'none';
      (window as any).layerDebugInfo = ` | Matrix: ${isArray ? 'array' : 'object'} | Keys: ${keys}`;
    }

    if (this.geometryNeedsUpdate) {
      this.updateBuffers();
    }

    if (this.vertexCount === 0 || !this.program || !this.locations) return;

    gl.useProgram(this.program);

    // Handle both old and new API
    const projMatrix = Array.isArray(matrix) ? matrix : matrix?.defaultProjectionData?.mainMatrix;
    if (!projMatrix) {
      (window as any).layerDebugInfo = ' | ERROR: No matrix';
      return;
    }

    gl.uniformMatrix4fv(this.locations.u_matrix as WebGLUniformLocation, false, projMatrix);
    gl.uniform3f(this.locations.u_lightDir as WebGLUniformLocation, 0.5, 0.5, 1.0);

    if (this.vertexBuffer && this.locations.a_position !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.vertexAttribPointer(this.locations.a_position as number, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locations.a_position as number);
    }

    if (this.normalBuffer && this.locations.a_normal !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
      gl.vertexAttribPointer(this.locations.a_normal as number, 3, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locations.a_normal as number);
    }

    if (this.typeBuffer && this.locations.a_type !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.typeBuffer);
      gl.vertexAttribPointer(this.locations.a_type as number, 1, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(this.locations.a_type as number);
    }

    // Try with depth test disabled to see if that's the issue
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
  }

  onRemove() {
    if (!this.gl) return;

    const gl = this.gl;
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.normalBuffer) gl.deleteBuffer(this.normalBuffer);
    if (this.typeBuffer) gl.deleteBuffer(this.typeBuffer);
    if (this.program) gl.deleteProgram(this.program);
  }
}
