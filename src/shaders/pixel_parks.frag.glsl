precision mediump float;

varying vec3 v_worldPos;
varying float v_parkType;

// Pixel size for grass texture
const float PIXEL_SIZE = 2.5;

// Hash function for procedural randomness
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Get base grass color based on park type
vec3 parkBaseColor(float type) {
  // Tree foliage
  if (type < -1.5) {
    return vec3(0.20, 0.45, 0.25); // Dark green foliage
  }
  // Tree trunk
  if (type < -0.5) {
    return vec3(0.35, 0.25, 0.15); // Brown trunk
  }

  if (type < 0.5) {
    // Nature reserve - darker, wilder green
    return vec3(0.25, 0.45, 0.30);
  } else if (type < 1.5) {
    // Protected area - medium green
    return vec3(0.30, 0.50, 0.35);
  }
  // Regular park - lighter green
  return vec3(0.35, 0.55, 0.40);
}

// Grass blade pattern
float grassPattern(vec2 pos) {
  vec2 pixelPos = floor(pos / PIXEL_SIZE);
  float h = hash(pixelPos);

  // Random grass blades (vertical strokes)
  if (h > 0.7) {
    float subHash = hash(pixelPos * 1.7);
    if (subHash > 0.6) {
      return 1.0; // Lighter grass blade
    }
  }

  return 0.0;
}

// Dirt patches (post-apocalyptic worn areas)
float dirtPatch(vec2 pos) {
  vec2 cellPos = floor(pos / (PIXEL_SIZE * 8.0));
  float h = hash(cellPos);

  // Sparse dirt patches
  if (h > 0.92) {
    vec2 localPos = mod(pos, PIXEL_SIZE * 8.0);
    vec2 center = vec2(PIXEL_SIZE * 4.0, PIXEL_SIZE * 4.0);
    float dist = length(localPos - center);

    if (dist < PIXEL_SIZE * 3.0) {
      return 1.0 - (dist / (PIXEL_SIZE * 3.0));
    }
  }

  return 0.0;
}

// Dead/brown grass patches (overgrown, neglected)
float deadGrassPattern(vec2 pos) {
  vec2 cellPos = floor(pos / (PIXEL_SIZE * 6.0));
  float h = hash(cellPos);

  // Brown/dead grass patches
  if (h > 0.88) {
    vec2 localPos = mod(pos, PIXEL_SIZE * 6.0);
    vec2 center = vec2(PIXEL_SIZE * 3.0, PIXEL_SIZE * 3.0);
    float dist = length(localPos - center);

    if (dist < PIXEL_SIZE * 2.5) {
      return 1.0 - (dist / (PIXEL_SIZE * 2.5));
    }
  }

  return 0.0;
}

// Weeds and wild plants (taller, darker spots)
float weedPattern(vec2 pos) {
  vec2 pixelPos = floor(pos / (PIXEL_SIZE * 1.5));
  float h = hash(pixelPos);

  // Random weed clumps
  if (h > 0.94) {
    float subHash = hash(pixelPos * 2.1);
    if (subHash > 0.5) {
      return 1.0;
    }
  }

  return 0.0;
}

// Wildflower spots (small colorful pixels)
vec3 wildflowerPattern(vec2 pos) {
  vec2 pixelPos = floor(pos / (PIXEL_SIZE * 3.0));
  float h = hash(pixelPos);

  // Very sparse wildflowers
  if (h > 0.96) {
    float colorHash = hash(pixelPos * 3.3);

    // Different flower colors
    if (colorHash > 0.75) {
      return vec3(0.9, 0.8, 0.3); // Yellow flowers
    } else if (colorHash > 0.5) {
      return vec3(0.8, 0.4, 0.7); // Purple/pink flowers
    } else if (colorHash > 0.25) {
      return vec3(0.9, 0.9, 0.9); // White flowers
    } else {
      return vec3(0.7, 0.3, 0.3); // Red flowers
    }
  }

  return vec3(0.0);
}

void main() {
  vec2 worldPos2D = v_worldPos.xy;
  vec3 baseColor = parkBaseColor(v_parkType);

  // Apply pixelated position
  vec2 pixelatedPos = floor(worldPos2D / PIXEL_SIZE) * PIXEL_SIZE;

  vec3 color = baseColor;

  // Trees (trunk and foliage) get simple rendering
  if (v_parkType < -0.5) {
    // Add some variation to tree color
    float variation = hash(pixelatedPos * 0.1) * 0.15;
    color = color * (0.9 + variation);
    gl_FragColor = vec4(color, 1.0);
    return;
  }

  // Ground/grass rendering
  // Apply dirt patches (brown spots)
  float dirt = dirtPatch(worldPos2D);
  if (dirt > 0.0) {
    vec3 dirtColor = vec3(0.45, 0.35, 0.25); // Brown dirt
    color = mix(color, dirtColor, dirt * 0.6);
  }

  // Apply dead grass patches (brownish)
  float deadGrass = deadGrassPattern(worldPos2D);
  if (deadGrass > 0.0) {
    vec3 deadColor = vec3(0.55, 0.50, 0.30); // Dead yellowish-brown
    color = mix(color, deadColor, deadGrass * 0.5);
  }

  // Apply grass blades (lighter green)
  float grass = grassPattern(worldPos2D);
  if (grass > 0.0) {
    vec3 grassColor = baseColor * 1.3; // Lighter blade
    color = mix(color, grassColor, 0.6);
  }

  // Apply weeds (darker green spots)
  float weeds = weedPattern(worldPos2D);
  if (weeds > 0.0) {
    vec3 weedColor = baseColor * 0.7; // Darker, wild growth
    color = mix(color, weedColor, 0.7);
  }

  // Apply wildflowers (small colorful spots)
  vec3 flowers = wildflowerPattern(worldPos2D);
  if (length(flowers) > 0.0) {
    color = mix(color, flowers, 0.8);
  }

  // Add noise/grain to entire surface
  float grain = hash(pixelatedPos) * 0.12;
  color = color * (0.90 + grain);

  gl_FragColor = vec4(color, 1.0);
}
