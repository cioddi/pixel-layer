const MAPLIBRE_COORD_BITS = 15;
const MAPLIBRE_COORD_MAX = Math.pow(2, MAPLIBRE_COORD_BITS - 1) - 1; // 16383
const MAPLIBRE_COORD_MIN = -MAPLIBRE_COORD_MAX - 1; // -16384

export const MAPLIBRE_TILE_EXTENT = 8192;

export type NormalizedRing = Array<{ x: number; y: number }>;
export type NormalizedGeometry = Array<NormalizedRing>;

export interface CanonicalLike {
  z: number;
  x: number;
  y: number;
}

const clampCoordinate = (value: number): number => {
  if (value < MAPLIBRE_COORD_MIN) return MAPLIBRE_COORD_MIN;
  if (value > MAPLIBRE_COORD_MAX) return MAPLIBRE_COORD_MAX;
  return value;
};

export function loadNormalizedGeometry(feature: any): NormalizedGeometry {
  const geometry: NormalizedGeometry = feature.loadGeometry();
  const extent = feature.extent || MAPLIBRE_TILE_EXTENT;
  const scale = MAPLIBRE_TILE_EXTENT / extent;

  for (const ring of geometry) {
    for (const point of ring) {
      const scaledX = Math.round(point.x * scale);
      const scaledY = Math.round(point.y * scale);
      point.x = clampCoordinate(scaledX);
      point.y = clampCoordinate(scaledY);
    }
  }

  return geometry;
}

export function getCanonicalTileID(tileID: any): CanonicalLike {
  const source = tileID?.canonical ?? tileID;
  if (!source) {
    return { z: 0, x: 0, y: 0 };
  }

  const z = typeof source.z === 'number'
    ? source.z
    : typeof source.overscaledZ === 'number'
      ? source.overscaledZ
      : 0;
  const x = typeof source.x === 'number' ? source.x : 0;
  const y = typeof source.y === 'number' ? source.y : 0;

  return { z, x, y };
}
