import type maplibregl from 'maplibre-gl';

const vertexSource = `
attribute vec3 a_position;
uniform mat4 u_posMatrix;
varying vec3 v_worldPos;

void main() {
  v_worldPos = a_position;
  gl_Position = u_posMatrix * vec4(a_position, 1.0);
}
`;

const fragmentSource = `
precision mediump float;
varying vec3 v_worldPos;

// Simplified hash function
float hash(vec2 p) {
  return fract(sin(p.x * 12.9898 + p.y * 78.233) * 43758.5);
}

void main() {
  // Use world coordinates for pixel art texture
  // Tile coordinates: 8192 units = 1 tile
  float pixelSize = 50.0;
  vec2 pixelPos = floor(v_worldPos.xy / pixelSize);

  // Simplified variation - single hash lookup
  float h = hash(pixelPos);

  // Base light brown color with variation
  vec3 color = vec3(0.55, 0.47, 0.38);
  color *= mix(0.92, 1.08, h);

  // Occasional darker spots
  if (h > 0.97) {
    color *= 0.85;
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

export class SimpleBackgroundLayer {
  id: string;
  type: 'custom';
  renderingMode: '3d';

  map?: maplibregl.Map;
  program?: WebGLProgram;
  buffer?: WebGLBuffer;
  aPos?: number;
  uMatrix?: WebGLUniformLocation | null;

  constructor() {
    this.id = 'simple-background';
    this.type = 'custom';
    this.renderingMode = '3d';
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    this.map = map;

    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) throw new Error('Failed to create program');

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Failed to link program: ' + gl.getProgramInfoLog(program));
    }

    this.program = program;
    this.aPos = gl.getAttribLocation(program, 'a_position');
    this.uMatrix = gl.getUniformLocation(program, 'u_posMatrix');

    // Create a large ground plane covering visible area
    // Use tile coordinate system - 8192 units = 1 tile
    const size = 8192 * 50; // Cover 50 tiles in each direction (plenty for most zoom levels)
    const z = -1; // Below water

    const vertices = new Float32Array([
      -size, -size, z,
       size, -size, z,
      -size,  size, z,
       size,  size, z
    ]);

    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  }

  render(gl: WebGLRenderingContext, matrix: number[]) {
    if (!this.program || !this.buffer || !this.map) return;

    // Skip rendering at very low zoom levels for performance
    const zoom = this.map.getZoom();
    if (zoom < 4) return;

    gl.useProgram(this.program);

    // Use the provided matrix for positioning
    if (this.uMatrix) {
      const posMatrix = matrix instanceof Float32Array ? matrix : new Float32Array(matrix);
      gl.uniformMatrix4fv(this.uMatrix, false, posMatrix);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.aPos!);
    gl.vertexAttribPointer(this.aPos!, 3, gl.FLOAT, false, 0, 0);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext) {
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Failed to create shader');

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error('Failed to compile shader: ' + gl.getShaderInfoLog(shader));
    }

    return shader;
  }
}
