precision mediump float;

varying vec3 v_worldPos;
varying float v_waterType;

uniform float u_time;
uniform float u_zoom;

// Pixel size for water texture
const float PIXEL_SIZE = 3.0;

// Hash function for procedural randomness
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash3(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

// Get base water color based on type (murky post-apocalyptic)
vec3 waterBaseColor(float type) {
  if (type < 0.5) {
    // Lake/Ocean - murky greenish-blue
    return vec3(0.20, 0.35, 0.40);
  }
  // River - slightly browner, more polluted
  return vec3(0.25, 0.32, 0.35);
}

// Static water pattern (no flickering ripples)
float waterPattern(vec2 pos) {
  vec2 pixelPos = floor(pos / (PIXEL_SIZE * 2.0));
  float h = hash(pixelPos);

  // Static darker/lighter patches
  return floor(h * 3.0) / 3.0;
}

// Oil slick patterns (iridescent pollution) - moving in one direction
vec3 oilSlickPattern(vec2 pos, float time) {
  // Move entire pattern slowly in one direction (diagonal)
  vec2 drift = vec2(time * 2.0, time * 1.0);
  vec2 pixelPos = floor((pos + drift) / (PIXEL_SIZE * 3.0));

  float h = hash(pixelPos);

  // Sparse oil slicks
  if (h > 0.96) {
    float oilHash = hash(pixelPos * 2.3);

    // Rainbow-ish iridescent colors (pollution)
    if (oilHash > 0.7) {
      return vec3(0.6, 0.3, 0.7); // Purple tint
    } else if (oilHash > 0.4) {
      return vec3(0.4, 0.6, 0.5); // Green tint
    } else {
      return vec3(0.5, 0.5, 0.3); // Yellow-brown tint
    }
  }

  return vec3(0.0);
}

// Debris and foam patterns - moving in one direction
float debrisPattern(vec2 pos, float time) {
  // Move entire pattern slowly in one direction (same as oil slicks)
  vec2 drift = vec2(time * 1.5, time * 0.75);
  vec2 pixelPos = floor((pos + drift) / (PIXEL_SIZE * 2.0));

  float h = hash(pixelPos);

  // Sparse debris
  if (h > 0.97) {
    return 1.0;
  }

  return 0.0;
}

// Foam/scum on edges (for rivers)
float foamPattern(vec2 pos, float waterType) {
  if (waterType > 0.5) {
    // Rivers have some foam
    vec2 pixelPos = floor(pos / (PIXEL_SIZE * 0.8));
    float h = hash(pixelPos);

    if (h > 0.95) {
      return 1.0;
    }
  }

  return 0.0;
}

void main() {
  vec2 worldPos2D = v_worldPos.xy;
  vec3 baseColor = waterBaseColor(v_waterType);

  // Apply pixelated position
  vec2 pixelatedPos = floor(worldPos2D / PIXEL_SIZE) * PIXEL_SIZE;

  vec3 color = baseColor;

  // Apply static water pattern (subtle lightening/darkening)
  float pattern = waterPattern(worldPos2D);
  color = mix(color * 0.90, color * 1.05, pattern);

  // Only render expensive details at higher zoom levels (14+)
  if (u_zoom >= 14.0) {
    // Apply oil slicks (iridescent pollution)
    vec3 oilSlick = oilSlickPattern(worldPos2D, u_time);
    if (length(oilSlick) > 0.0) {
      color = mix(color, oilSlick, 0.4);
    }

    // Apply debris (darker spots)
    float debris = debrisPattern(worldPos2D, u_time);
    if (debris > 0.0) {
      vec3 debrisColor = baseColor * 0.5; // Darker floating debris
      color = mix(color, debrisColor, 0.6);
    }

    // Apply foam/scum (lighter spots)
    float foam = foamPattern(worldPos2D, v_waterType);
    if (foam > 0.0) {
      vec3 foamColor = vec3(0.7, 0.7, 0.65); // Dirty yellowish foam
      color = mix(color, foamColor, 0.5);
    }
  }

  // Add static noise/grain to entire surface
  float grain = hash(pixelatedPos) * 0.08;
  color = color * (0.92 + grain);

  gl_FragColor = vec4(color, 1.0);
}
