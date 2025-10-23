import './style.css'
import maplibregl from 'maplibre-gl'
import {
  PixelArtBuildingsLayerSimple,
  PixelArtRoadsLayer,
  PixelArtWaterLayer,
  PixelArtParksLayer,
  PixelArtLanduseLayer,
  SimpleBackgroundLayer,
  VTDebugLayer
} from '../src'

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

const statusDisplay = document.createElement('div')
statusDisplay.id = 'status-display'
statusDisplay.style.cssText = `
  position: absolute;
  bottom: 10px;
  left: 10px;
  max-width: 320px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  padding: 8px 12px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
  z-index: 1000;
  pointer-events: none;
  white-space: pre-wrap;
`
statusDisplay.textContent = 'status: initialising…'
document.body.appendChild(statusDisplay)

const updateStatus = (message: string) => {
  statusDisplay.textContent = message
}

window.addEventListener('error', (event) => {
  updateStatus(`error: ${event.message}`)
})

window.addEventListener('unhandledrejection', (event) => {
  updateStatus(`promise error: ${event.reason}`)
})

const map = new maplibregl.Map({
  container: 'map',
  style: '/pixel-layer/empty-style.json',
  center: [13.4, 52.52],
  zoom: 16,
  pitch: 60
})
updateStatus('status: map created, waiting for load…')

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
  updateStatus('status: map load event fired')

  const layerDefs: LayerDefinition[] = [
    {
      id: 'simple-background',
      label: 'Background',
      create: () => new SimpleBackgroundLayer()
    },
    {
      id: 'pixel-art-parks',
      label: 'Parks',
      create: () => new PixelArtParksLayer({
        source: 'openmaptiles',
        sourceLayer: 'park',
        enableTrees: false
      })
    },
    {
      id: 'pixel-art-landcover',
      label: 'Landcover',
      create: () => new PixelArtLanduseLayer({
        id: 'pixel-art-landcover',
        source: 'openmaptiles',
        sourceLayer: 'landcover',
        enableTrees: false
      })
    },
    {
      id: 'pixel-art-landuse',
      label: 'Landuse',
      create: () => new PixelArtLanduseLayer({
        id: 'pixel-art-landuse',
        source: 'openmaptiles',
        sourceLayer: 'landuse',
        enableTrees: false
      })
    },
    {
      id: 'pixel-art-water',
      label: 'Water',
      create: () => new PixelArtWaterLayer({ source: 'openmaptiles', sourceLayer: 'water' })
    },
    {
      id: 'pixel-art-roads',
      label: 'Roads',
      create: () => new PixelArtRoadsLayer({
        source: 'openmaptiles',
        sourceLayer: 'transportation'
      })
    },
    {
      id: 'pixel-art-buildings',
      label: 'Buildings',
      create: () => new PixelArtBuildingsLayerSimple({
        source: 'openmaptiles',
        sourceLayer: 'building',
        heightProperty: ['render_height', 'height'],
        minHeightProperty: ['render_min_height', 'min_height'],
        colorProperty: 'building'
      })
    },
    {
      id: 'vt-debug-layer-demo',
      label: 'Tile Debug',
      defaultVisible: true,
      create: () => new VTDebugLayer({
        id: 'vt-debug-layer-demo',
        lineColor: [1, 1, 0, 0.8],
        lineWidth: 1,
        showLabels: true
      })
    }
  ]

  const layerState = new Map<string, maplibregl.CustomLayerInterface>()

  for (const def of layerDefs) {
    if (def.defaultVisible === false) {
      continue
    }

    try {
      const instance = def.create()
      map.addLayer(instance as any)
      layerState.set(def.id, instance)
      updateStatus(`status: added ${def.label}`)
    } catch (err) {
      updateStatus(`error adding ${def.label}: ${String(err)}`)
      console.error(err)
    }
  }

  createLayerControl(map, layerDefs, layerState)
  updateStatus('status: layers added, awaiting data…')
})

map.on('idle', () => {
  const zoom = map.getZoom().toFixed(2)
  updateStatus(`status: map idle at zoom ${zoom}`)
})

type LayerDefinition = {
  id: string;
  label: string;
  create: () => maplibregl.CustomLayerInterface;
  defaultVisible?: boolean;
};

function createLayerControl(
  map: maplibregl.Map,
  definitions: LayerDefinition[],
  state: Map<string, maplibregl.CustomLayerInterface>
) {
  const container = document.createElement('div');
  container.className = 'layer-control';

  const toggleButton = document.createElement('button');
  toggleButton.className = 'layer-control__toggle';
  toggleButton.type = 'button';
  toggleButton.innerHTML = 'Layers<span>▾</span>';

  const list = document.createElement('div');
  list.className = 'layer-control__list';
  list.classList.add('layer-control__list--open');
  toggleButton.classList.add('layer-control__toggle--open');

  toggleButton.addEventListener('click', () => {
    list.classList.toggle('layer-control__list--open');
    toggleButton.classList.toggle('layer-control__toggle--open');
  });

  definitions.forEach((config, idx) => {
    const item = document.createElement('label');
    item.className = 'layer-control__item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'layer-control__checkbox';
    checkbox.checked = state.has(config.id);
    if (config.defaultVisible === false) {
      checkbox.checked = false;
    }

    checkbox.addEventListener('change', () => {
      setLayerVisible(map, config, checkbox.checked, definitions, state, idx);
    });

    const label = document.createElement('span');
    label.className = 'layer-control__label';
    label.textContent = config.label;

    item.appendChild(checkbox);
    item.appendChild(label);
    list.appendChild(item);
  });

  container.appendChild(toggleButton);
  container.appendChild(list);
  document.body.appendChild(container)
}

function setLayerVisible(
  map: maplibregl.Map,
  config: LayerDefinition,
  visible: boolean,
  definitions: LayerDefinition[],
  state: Map<string, maplibregl.CustomLayerInterface>,
  index: number
) {
  const isPresent = state.has(config.id);

  if (visible && !isPresent) {
    const instance = config.create();
    const beforeId = findInsertBefore(map, definitions, state, index);
    map.addLayer(instance as any, beforeId);
    state.set(config.id, instance);
  } else if (!visible && isPresent) {
    map.removeLayer(config.id);
    state.delete(config.id);
  }
}

function findInsertBefore(
  map: maplibregl.Map,
  configs: LayerDefinition[],
  state: Map<string, maplibregl.CustomLayerInterface>,
  index: number
): string | undefined {
  for (let i = index + 1; i < configs.length; i++) {
    const cfg = configs[i];
    if (state.has(cfg.id) && map.getLayer(cfg.id)) {
      return cfg.id;
    }
  }
  return undefined;
}
