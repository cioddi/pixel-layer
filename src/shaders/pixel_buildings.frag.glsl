precision highp float;

varying vec3 v_normal;
varying float v_type;
varying vec3 v_worldPos;

uniform vec3 u_lightDir;

// Pixel size in world units (tile coordinates)
const float PIXEL_SIZE = 3.0; // Size of each "pixel/voxel" in meters

// Hash function for deterministic randomness
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Get base color based on building type (brighter)
vec3 typeColor(float type) {
  if (type < 0.5) {
    // Cathedral/Church - red brick (brighter)
    return vec3(0.75, 0.40, 0.35);
  } else if (type < 1.5) {
    // Industrial - greenish/gray (brighter)
    return vec3(0.50, 0.55, 0.50);
  }
  // Residential - light gray/beige (brighter)
  return vec3(0.70, 0.65, 0.60);
}

// Generate window pattern (reduced density)
float windowPattern(vec2 pixelCoord, float buildingType) {
  vec2 cell = fract(pixelCoord);
  vec2 cellId = floor(pixelCoord);

  // Different window patterns for different building types - all less dense
  if (buildingType < 0.5) {
    // Cathedral - tall arched windows, very sparse
    if (mod(cellId.x, 6.0) > 1.0 && mod(cellId.x, 6.0) < 3.0) {
      if (mod(cellId.y, 8.0) > 2.0 && mod(cellId.y, 8.0) < 6.0) {
        return hash(cellId) > 0.4 ? 1.0 : 0.0;
      }
    }
  } else if (buildingType < 1.5) {
    // Industrial - sparse, larger windows
    if (mod(cellId.x, 5.0) > 1.0 && mod(cellId.x, 5.0) < 3.0) {
      if (mod(cellId.y, 6.0) > 1.5 && mod(cellId.y, 6.0) < 4.0) {
        return hash(cellId) > 0.5 ? 1.0 : 0.0;
      }
    }
  } else {
    // Residential - regular grid but less dense
    if (mod(cellId.x, 4.0) > 0.5 && mod(cellId.x, 4.0) < 2.0) {
      if (mod(cellId.y, 5.0) > 1.0 && mod(cellId.y, 5.0) < 3.5) {
        float lit = hash(cellId) > 0.6 ? 1.0 : 0.3;
        return lit;
      }
    }
  }

  return 0.0;
}

void main() {
  vec3 baseColor = typeColor(v_type);
  vec3 normal = normalize(v_normal);
  vec3 lightDir = normalize(u_lightDir);

  // Determine if this is a roof (normal pointing up) or wall
  bool isRoof = abs(normal.z) > 0.9;

  vec3 color = baseColor;

  if (!isRoof) {
    // Wall - add window pattern
    // Use X/Y coordinates for vertical walls, incorporating Z (height) for vertical positioning
    vec2 wallCoord;

    if (abs(normal.x) > abs(normal.y)) {
      // Wall facing X direction - use Y and Z
      wallCoord = vec2(v_worldPos.y, v_worldPos.z);
    } else {
      // Wall facing Y direction - use X and Z
      wallCoord = vec2(v_worldPos.x, v_worldPos.z);
    }

    // Pixelate the coordinates
    vec2 pixelCoord = wallCoord / PIXEL_SIZE;

    // Generate window pattern
    float window = windowPattern(pixelCoord, v_type);

    if (window > 0.5) {
      // Window lit up - bright yellow/orange
      color = mix(baseColor, vec3(1.0, 0.95, 0.7), 0.7);
    } else if (window > 0.1) {
      // Window dark - less dark than before
      color = baseColor * 0.6;
    }

  } else {
    // Roof - industrial/post-apocalyptic style
    vec2 roofCoord = v_worldPos.xy / PIXEL_SIZE;
    vec2 roofCell = floor(roofCoord);
    float cellHash = hash(roofCell);

    // Base roof color with rust tint (brighter)
    vec3 roofBase = baseColor * 0.7;
    vec3 rustColor = vec3(0.60, 0.40, 0.30); // Rusty orange-brown (brighter)
    vec3 darkMetal = vec3(0.35, 0.37, 0.40); // Dark metallic (brighter)
    vec3 dirtyGreen = vec3(0.40, 0.50, 0.40); // Moss/oxidation (brighter)

    // Metal panel seams - create grid pattern
    vec2 panelCoord = mod(roofCoord, 4.0);
    bool isSeam = panelCoord.x < 0.2 || panelCoord.y < 0.2;

    if (isSeam) {
      // Seams between panels (brighter)
      color = darkMetal * 0.9;
    } else {
      // Panel surface with weathering
      float weathering = hash(roofCell * 0.3);

      if (weathering > 0.7) {
        // Rust spots
        color = mix(roofBase, rustColor, weathering - 0.7);
      } else if (weathering > 0.5) {
        // Dirty/oxidized areas
        color = mix(roofBase, dirtyGreen, (weathering - 0.5) * 2.0);
      } else {
        // Normal weathered metal
        color = roofBase * (0.8 + cellHash * 0.3);
      }

      // Add vents/chimneys on some cells
      vec2 ventCoord = mod(roofCoord, 8.0);
      float ventHash = hash(floor(roofCoord / 8.0));

      if (ventHash > 0.75) {
        // Place a vent/chimney
        if (ventCoord.x > 2.0 && ventCoord.x < 4.0 &&
            ventCoord.y > 2.0 && ventCoord.y < 4.0) {
          // Vent structure - darker and more metallic
          color = darkMetal * 1.3;
        }
      }
    }

    // Add subtle grime variation (less dark)
    float grime = hash(roofCell * 0.1) * 0.1;
    color = color * (0.95 - grime);
  }

  // Apply lighting with higher ambient
  float diffuse = max(dot(normal, lightDir), 0.4);
  color = color * diffuse;

  gl_FragColor = vec4(color, 1.0);
}
