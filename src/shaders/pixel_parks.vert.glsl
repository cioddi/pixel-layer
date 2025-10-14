attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_parkType;

uniform mat4 u_posMatrix;

varying vec3 v_worldPos;
varying float v_parkType;

void main() {
  v_worldPos = a_position;
  v_parkType = a_parkType;
  gl_Position = u_posMatrix * vec4(a_position, 1.0);
}
