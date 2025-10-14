export function compileShader(gl: WebGLRenderingContext, source: string, type: number): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(error || 'Shader compilation failed');
  }
  return shader;
}

export function createProgram(gl: WebGLRenderingContext, vertSource: string, fragSource: string): WebGLProgram {
  const vertShader = compileShader(gl, vertSource, gl.VERTEX_SHADER);
  const fragShader = compileShader(gl, fragSource, gl.FRAGMENT_SHADER);

  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create program');
  }
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(error || 'Program linking failed');
  }

  return program;
}

export function getLocations(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  attributes: string[],
  uniforms: string[]
): Record<string, number | WebGLUniformLocation | null> {
  const locations: Record<string, number | WebGLUniformLocation | null> = {};
  attributes.forEach(name => {
    locations[name] = gl.getAttribLocation(program, name);
  });
  uniforms.forEach(name => {
    locations[name] = gl.getUniformLocation(program, name);
  });
  return locations;
}
