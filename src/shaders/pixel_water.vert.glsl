attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_waterType;

uniform mat4 u_posMatrix;

varying vec3 v_worldPos;
varying float v_waterType;

void main() {
  v_worldPos = a_position;
  v_waterType = a_waterType;
  gl_Position = u_posMatrix * vec4(a_position, 1.0);
}
