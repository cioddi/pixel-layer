attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_landuseType;

uniform mat4 u_posMatrix;

varying vec3 v_worldPos;
varying float v_landuseType;

void main() {
  v_worldPos = a_position;
  v_landuseType = a_landuseType;
  gl_Position = u_posMatrix * vec4(a_position, 1.0);
}
