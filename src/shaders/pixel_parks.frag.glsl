precision mediump float;

varying vec3 v_worldPos;
varying float v_parkType;

uniform float u_zoom;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Nature reserve - dense, wild vegetation
vec3 natureReserve(vec2 pos) {
  vec3 base = vec3(0.24, 0.48, 0.28);

  // Dense vegetation patches
  vec2 cell = floor(pos / 24.0);
  float variation = hash(cell * 1.5);
  base *= mix(0.75, 1.2, variation);

  // Wild grass texture
  vec2 pixel = floor(pos / 5.0);
  float grass = hash(pixel * 2.3);
  if (grass > 0.7) {
    base *= 1.2;
  }

  // Wild flowers scattered
  vec2 flowerCell = floor(pos / 40.0);
  float flowerSeed = hash(flowerCell * 3.1);
  if (flowerSeed > 0.94) {
    vec3 wildFlower;
    float choice = hash(flowerCell * 4.7);
    if (choice > 0.5) wildFlower = vec3(0.75, 0.65, 0.85); // Purple
    else wildFlower = vec3(0.95, 0.85, 0.35); // Yellow
    base = mix(base, wildFlower, 0.25);
  }

  return base;
}

// Protected area - maintained but natural
vec3 protectedArea(vec2 pos) {
  vec3 base = vec3(0.28, 0.54, 0.32);

  // Maintained grass
  vec2 cell = floor(pos / 28.0);
  float variation = hash(cell * 1.7);
  base *= mix(0.85, 1.15, variation);

  // Neat grass blades
  vec2 pixel = floor(pos / 6.0);
  float blade = hash(pixel * 2.5);
  if (blade > 0.8) {
    base *= 1.12;
  }

  // Sparse flowers
  vec2 flowerCell = floor(pos / 52.0);
  float flowerSeed = hash(flowerCell * 2.9);
  if (flowerSeed > 0.95) {
    vec3 flowerColor = vec3(0.9, 0.75, 0.4);
    base = mix(base, flowerColor, 0.3);
  }

  return base;
}

// Regular park - well-maintained, recreational
vec3 regularPark(vec2 pos) {
  vec3 base = vec3(0.32, 0.58, 0.36);

  // Even grass coverage
  vec2 cell = floor(pos / 32.0);
  float variation = hash(cell * 1.9);
  base *= mix(0.9, 1.1, variation);

  // Manicured grass
  vec2 pixel = floor(pos / 7.0);
  float grass = hash(pixel * 2.7);
  if (grass > 0.85) {
    base *= 1.08;
  }

  // Decorative flowers
  vec2 flowerCell = floor(pos / 45.0);
  float flowerSeed = hash(flowerCell * 3.3);
  if (flowerSeed > 0.93) {
    vec3 flowerColor;
    float choice = hash(flowerCell * 5.9);
    if (choice > 0.66) flowerColor = vec3(0.95, 0.3, 0.35); // Red
    else if (choice > 0.33) flowerColor = vec3(0.85, 0.45, 0.75); // Pink
    else flowerColor = vec3(0.95, 0.95, 0.4); // Yellow
    base = mix(base, flowerColor, 0.35);
  }

  return base;
}

void main() {
  vec2 pos = v_worldPos.xy;
  vec3 color;

  // Trees (trunk and foliage) get simple rendering
  if (v_parkType < -1.5) {
    // Type -2: Green foliage
    color = vec3(0.18, 0.40, 0.22);
    float variation = hash(floor(pos / 5.0)) * 0.15;
    color = color * (0.85 + variation);
    gl_FragColor = vec4(color, 1.0);
    return;
  } else if (v_parkType < -0.5) {
    // Type -1: Brown trunk
    color = vec3(0.36, 0.26, 0.17);
    float variation = hash(floor(pos / 5.0)) * 0.15;
    color = color * (0.85 + variation);
    gl_FragColor = vec4(color, 1.0);
    return;
  }

  // Ground rendering with detail based on zoom level
  if (u_zoom < 10.0) {
    // Simple colors for low zoom levels
    if (v_parkType < 0.5) {
      color = vec3(0.26, 0.50, 0.30); // Nature reserve
    } else if (v_parkType < 1.5) {
      color = vec3(0.30, 0.56, 0.34); // Protected area
    } else {
      color = vec3(0.34, 0.60, 0.38); // Regular park
    }
  } else {
    // Detailed textures for higher zoom levels
    if (v_parkType < 0.5) {
      color = natureReserve(pos);
    } else if (v_parkType < 1.5) {
      color = protectedArea(pos);
    } else {
      color = regularPark(pos);
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
