import './style.css'
import maplibregl from 'maplibre-gl'
import { PixelArtBuildingsLayerSimple } from './layers/PixelArtBuildingsLayerSimple'
import { PixelArtRoadsLayer } from './layers/PixelArtRoadsLayer'
import { PixelArtWaterLayer } from './layers/PixelArtWaterLayer'
import { PixelArtParksLayer } from './layers/PixelArtParksLayer'
import { PixelArtLanduseLayer } from './layers/PixelArtLanduseLayer'
import { SimpleBackgroundLayer } from './layers/SimpleBackgroundLayer'

const map = new maplibregl.Map({
  container: 'map',
  style: '/empty-style.json',
  center: [13.4, 52.52],
  zoom: 16,
  pitch: 60
})

// Create zoom level display
const zoomDisplay = document.createElement('div')
zoomDisplay.id = 'zoom-display'
zoomDisplay.style.cssText = `
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 14px;
  z-index: 1000;
  pointer-events: none;
`
document.body.appendChild(zoomDisplay)

// Update zoom display
const updateZoomDisplay = () => {
  const zoom = map.getZoom()
  const center = map.getCenter()
  zoomDisplay.textContent = `Zoom: ${zoom.toFixed(2)} | Center: ${center.lng.toFixed(2)}, ${center.lat.toFixed(2)}`
}

// Update on zoom
map.on('zoom', updateZoomDisplay)
map.on('load', updateZoomDisplay)

map.on('load', () => {
  // Add simple pixel art background
  const simpleBackground = new SimpleBackgroundLayer()
  map.addLayer(simpleBackground as any, 'building')

  // Add pixel art water layer (render above background)
  const pixelWaterLayer = new PixelArtWaterLayer({
    source: 'openmaptiles',
    sourceLayer: 'water'
  })
  map.addLayer(pixelWaterLayer as any)

  const pixelLandcoverLayer = new PixelArtLanduseLayer({
    id: 'pixel-art-landcover',
    source: 'openmaptiles',
    sourceLayer: 'landcover'
  })
  map.addLayer(pixelLandcoverLayer as any)

  const pixelLanduseLayer = new PixelArtLanduseLayer({
    id: 'pixel-art-landuse',
    source: 'openmaptiles',
    sourceLayer: 'landuse'
  })
  map.addLayer(pixelLanduseLayer as any)

  const pixelParksLayer = new PixelArtParksLayer({
    source: 'openmaptiles',
    sourceLayer: 'park'
  })
  map.addLayer(pixelParksLayer as any)

  // Add pixel art roads layer (render above parks, below buildings)
  const pixelRoadsLayer = new PixelArtRoadsLayer({
    source: 'openmaptiles',
    sourceLayer: 'transportation'
  })
  map.addLayer(pixelRoadsLayer as any)

  // Add pixel art buildings layer
  const pixelBuildingsLayer = new PixelArtBuildingsLayerSimple({
    source: 'openmaptiles',
    sourceLayer: 'building',
    heightProperty: ['render_height', 'height'],
    minHeightProperty: ['render_min_height', 'min_height'],
    colorProperty: 'building'
  })
  map.addLayer(pixelBuildingsLayer as any)
})
