precision mediump float;

varying vec3 v_worldPos;
varying float v_roadType;
varying vec2 v_texCoord;

// Pixel size for road texture
const float PIXEL_SIZE = 2.0;

// Hash function for procedural randomness
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// Get base asphalt color based on road type (lighter grey)
vec3 roadBaseColor(float type) {
  if (type < 0.5) {
    // Highway - medium grey
    return vec3(0.50, 0.50, 0.52);
  } else if (type < 1.5) {
    // Primary road - lighter grey
    return vec3(0.55, 0.55, 0.57);
  } else if (type < 2.5) {
    // Secondary - light grey
    return vec3(0.60, 0.60, 0.62);
  }
  // Residential - lightest grey
  return vec3(0.65, 0.65, 0.67);
}

// Generate cracked asphalt texture
float crackPattern(vec2 pos, float roadType) {
  vec2 pixelPos = floor(pos / PIXEL_SIZE);
  float h = hash(pixelPos);

  // Visible cracks on all roads
  float crackThreshold;
  if (roadType < 1.5) {
    // Highway and primary - visible weathering
    crackThreshold = 0.95 - roadType * 0.01;
  } else {
    // Secondary and residential - visible weathering
    crackThreshold = 0.95 + roadType * 0.005;
  }

  if (h > crackThreshold) {
    // This pixel is a crack
    return 1.0;
  }

  // Check adjacent pixels for crack continuation
  vec2 offset = fract(pos / PIXEL_SIZE);
  if (offset.x < 0.3 && hash(pixelPos + vec2(-1.0, 0.0)) > crackThreshold) return 0.6;
  if (offset.x > 0.7 && hash(pixelPos + vec2(1.0, 0.0)) > crackThreshold) return 0.6;
  if (offset.y < 0.3 && hash(pixelPos + vec2(0.0, -1.0)) > crackThreshold) return 0.6;
  if (offset.y > 0.7 && hash(pixelPos + vec2(0.0, 1.0)) > crackThreshold) return 0.6;

  return 0.0;
}

// Generate potholes - extremely rare, randomly placed
float potholePattern(vec2 pos, float roadType) {
  // Use multiple hash values for more random distribution
  vec2 offset1 = vec2(hash(pos * 0.1), hash(pos * 0.1 + vec2(13.7, 27.3)));
  vec2 offset2 = vec2(hash(pos * 0.03), hash(pos * 0.03 + vec2(41.2, 19.8)));

  // Combine offsets for truly random positions
  vec2 randomPos = pos + offset1 * 100.0 + offset2 * 50.0;
  vec2 cellPos = floor(randomPos / 80.0); // Large cells
  float h = hash(cellPos);

  // Occasional potholes scattered randomly
  if (h > 0.99) { // 1% chance
    vec2 potholeCenter = (cellPos + 0.5) * 80.0 - offset1 * 100.0 - offset2 * 50.0;
    float dist = length(pos - potholeCenter);

    if (dist < 2.0 + hash(cellPos * 1.7) * 1.5) {
      // Inside pothole - darker and rough
      return 1.0 - (dist / 3.5);
    }
  }

  return 0.0;
}

// Lane markings (faded and worn) - returns marking strength and type (0=none, 1=white, 2=yellow)
vec2 laneMarking(vec2 pos, float roadType) {
  // Only highways and primary roads have visible markings
  if (roadType > 1.5) return vec2(0.0, 0.0);

  // Dashed line pattern along the road center
  float alongRoad = v_texCoord.x * 100.0; // Along road direction
  float acrossRoad = v_texCoord.y; // Across road (0 = edge, 0.5 = center)

  // Center line (dashed) - yellow in some places
  if (abs(acrossRoad - 0.5) < 0.05) {
    float dashPattern = mod(alongRoad, 10.0);
    if (dashPattern < 5.0) {
      // Faded marking with noise
      float fade = hash(floor(alongRoad / 10.0) * vec2(1.0, 0.0));
      if (fade > 0.3) {
        // 30% yellow, 70% white center lines
        float colorHash = hash(floor(alongRoad / 50.0) * vec2(0.5, 0.0));
        float markingType = colorHash > 0.7 ? 2.0 : 1.0; // 2=yellow, 1=white
        return vec2(0.7, markingType);
      }
    }
  }

  // Edge lines (solid but faded) - mostly white
  if (acrossRoad < 0.08 || acrossRoad > 0.92) {
    float fade = hash(floor(pos.x / 5.0) * vec2(pos.y / 5.0, 1.0));
    if (fade > 0.4) {
      return vec2(0.5, 1.0); // White edge lines
    }
  }

  return vec2(0.0, 0.0);
}

// Dirt and debris overlay
float dirtOverlay(vec2 pos, float roadType) {
  vec2 pixelPos = floor(pos / (PIXEL_SIZE * 0.5));
  float h = hash(pixelPos);

  // Visible dirt on all roads
  float dirtThreshold = 0.85; // More visible dirt patches

  if (h > dirtThreshold) {
    return (h - dirtThreshold) * 0.2;
  }

  return 0.0;
}

void main() {
  vec2 worldPos2D = v_worldPos.xy;
  vec3 baseColor = roadBaseColor(v_roadType);

  // Apply pixelated position
  vec2 pixelatedPos = floor(worldPos2D / PIXEL_SIZE) * PIXEL_SIZE;

  vec3 color = baseColor;

  // Apply cracks (lighter darkening)
  float crack = crackPattern(worldPos2D, v_roadType);
  if (crack > 0.5) {
    color *= 0.75; // Deep cracks - not too dark
  } else if (crack > 0.0) {
    color *= 0.85; // Shallow cracks - subtle
  }

  // Apply potholes (road-type dependent)
  float pothole = potholePattern(worldPos2D, v_roadType);
  if (pothole > 0.0) {
    // Potholes - slightly darker grey, not brown dirt
    vec3 potholeColor = baseColor * 0.85; // Just darker asphalt - lighter weathering
    color = mix(color, potholeColor, pothole * 0.3);
  }

  // Apply lane markings (white or yellow)
  vec2 marking = laneMarking(worldPos2D, v_roadType);
  if (marking.x > 0.0) {
    vec3 markingColor;
    if (marking.y > 1.5) {
      // Yellow marking
      markingColor = vec3(0.95, 0.85, 0.35);
    } else {
      // White marking
      markingColor = vec3(0.95, 0.95, 0.90);
    }
    color = mix(color, markingColor, marking.x);
  }

  // Apply dirt and debris (road-type dependent)
  float dirt = dirtOverlay(worldPos2D, v_roadType);
  if (dirt > 0.0) {
    vec3 dirtColor = baseColor * 0.85; // Darker grey for visible dirt - lighter weathering
    color = mix(color, dirtColor, dirt * 0.4);
  }

  // Add noise/grain to entire surface
  float grain = hash(pixelatedPos) * 0.1;
  color = color * (0.95 + grain);

  gl_FragColor = vec4(color, 1.0);
}
