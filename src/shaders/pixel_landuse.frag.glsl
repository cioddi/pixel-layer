precision mediump float;

varying vec3 v_worldPos;
varying float v_landuseType;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 rotate(vec2 p, float angle) {
  float s = sin(angle);
  float c = cos(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 meadow(vec2 pos) {
  vec3 base = vec3(0.34, 0.58, 0.37);
  vec2 cell = floor(pos / 32.0);
  float variation = hash(cell * 1.3);
  base *= mix(0.85, 1.1, variation);
  vec2 pixel = floor(pos / 6.0);
  float blade = hash(pixel * 2.1);
  if (blade > 0.82) {
    base *= 1.15;
  }
  vec2 flowerCell = floor(pos / 48.0);
  float flowerSeed = hash(flowerCell * 2.7);
  if (flowerSeed > 0.96) {
    vec3 flowerColor;
    float choice = hash(flowerCell * 5.3);
    if (choice > 0.66) flowerColor = vec3(0.9, 0.8, 0.3);
    else if (choice > 0.33) flowerColor = vec3(0.85, 0.45, 0.7);
    else flowerColor = vec3(0.95, 0.95, 0.95);
    base = mix(base, flowerColor, 0.35);
  }
  return base;
}

vec3 garden(vec2 pos) {
  vec3 soil = vec3(0.50, 0.62, 0.38);
  vec2 grid = mod(pos, 28.0);
  float path = step(grid.x, 2.0) + step(grid.y, 2.0) + step(26.0, grid.x) + step(26.0, grid.y);
  if (path > 0.0) {
    soil = vec3(0.62, 0.55, 0.42);
  } else {
    vec2 patch = floor(pos / 14.0);
    float patchSeed = hash(patch * 3.9);
    soil *= mix(0.85, 1.15, patchSeed);
  }
  vec2 pot = floor(pos / 10.0);
  if (hash(pot * 4.1) > 0.92) {
    soil = mix(soil, vec3(0.45, 0.33, 0.24), 0.5);
  }
  return soil;
}

vec3 farmland(vec2 pos) {
  vec2 cell = floor(pos / 160.0);
  float angle = hash(cell * 1.7) * 3.14159;
  vec2 local = rotate(pos, angle);
  float band = fract(local.x / 28.0);
  float stripe = step(band, 0.55);
  vec3 soil = vec3(0.60, 0.49, 0.34);
  vec3 crop = vec3(0.44, 0.64, 0.32);
  vec3 color = mix(crop, soil, stripe);
  float scratch = hash(floor(local / 18.0));
  color *= mix(0.9, 1.08, scratch);
  return color;
}

vec3 orchard(vec2 pos) {
  vec3 base = vec3(0.31, 0.54, 0.36);
  vec2 cell = floor(pos / 56.0);
  vec2 local = mod(pos, 56.0) - 28.0;
  float tree = smoothstep(1.0, 0.0, length(local) / 14.0);
  vec3 treeColor = vec3(0.22, 0.40, 0.24);
  base = mix(base, treeColor, tree * 0.8);
  float blossomSeed = hash(cell * 6.1);
  if (blossomSeed > 0.97) {
    vec3 blossom = vec3(0.95, 0.75, 0.78);
    base = mix(base, blossom, 0.4);
  }
  float path = step(mod(pos.x, 56.0), 3.0) + step(mod(pos.y, 56.0), 3.0);
  if (path > 0.0) {
    base = mix(base, vec3(0.55, 0.47, 0.36), 0.6);
  }
  return base;
}

void main() {
  vec2 pos = v_worldPos.xy;
  vec3 color;

  // Trees (trunk and foliage) get simple rendering
  if (v_landuseType < -3.5) {
    // Type -4: Light green deciduous foliage
    color = vec3(0.35, 0.55, 0.35);
    float variation = hash(floor(pos / 5.0)) * 0.15;
    color = color * (0.9 + variation);
    gl_FragColor = vec4(color, 1.0);
    return;
  } else if (v_landuseType < -2.5) {
    // Type -3: Dark green conifer foliage
    color = vec3(0.15, 0.35, 0.20);
    float variation = hash(floor(pos / 5.0)) * 0.15;
    color = color * (0.9 + variation);
    gl_FragColor = vec4(color, 1.0);
    return;
  } else if (v_landuseType < -1.5) {
    // Type -2: Standard green foliage
    color = vec3(0.22, 0.48, 0.28);
    float variation = hash(floor(pos / 5.0)) * 0.15;
    color = color * (0.9 + variation);
    gl_FragColor = vec4(color, 1.0);
    return;
  } else if (v_landuseType < -0.5) {
    // Type -1: Tree trunk (brown)
    color = vec3(0.38, 0.27, 0.17);
    float variation = hash(floor(pos / 5.0)) * 0.15;
    color = color * (0.9 + variation);
    gl_FragColor = vec4(color, 1.0);
    return;
  }

  // Ground/landuse rendering
  if (v_landuseType < 0.5) {
    color = meadow(pos);
  } else if (v_landuseType < 1.5) {
    color = garden(pos);
  } else if (v_landuseType < 2.5) {
    color = farmland(pos);
  } else {
    color = orchard(pos);
  }
  gl_FragColor = vec4(color, 1.0);
}
