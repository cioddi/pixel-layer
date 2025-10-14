attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_type;

uniform mat4 u_posMatrix;
uniform vec3 u_lightDir;

varying vec3 v_normal;
varying float v_type;
varying vec3 v_worldPos;

void main() {
  v_normal = a_normal;
  v_type = a_type;
  v_worldPos = a_position;
  gl_Position = u_posMatrix * vec4(a_position, 1.0);
}
