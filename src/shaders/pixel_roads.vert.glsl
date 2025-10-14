attribute vec3 a_position;
attribute vec3 a_normal;
attribute float a_roadType;
attribute vec2 a_texCoord;

uniform mat4 u_posMatrix;

varying vec3 v_worldPos;
varying float v_roadType;
varying vec2 v_texCoord;

void main() {
  v_worldPos = a_position;
  v_roadType = a_roadType;
  v_texCoord = a_texCoord;
  gl_Position = u_posMatrix * vec4(a_position, 1.0);
}
