# Pixel Layer

Pixel Layer packages the custom MapLibre layers used by the demo application into a reusable library. The project now produces an npm package that exposes every custom layer class together with their TypeScript types, and ships a separate demo build that exercises the default OpenMapTiles configuration.

## Installation

```bash
npm install pixel-layer maplibre-gl
```

The package treats `maplibre-gl` as a peer dependency so you can align it with the version used by your application. The library bundles the minimal runtime helpers it needs (`earcut`, `gl-matrix`).

## Usage

```ts
import maplibregl from 'maplibre-gl';
import {
  PixelArtBuildingsLayerSimple,
  PixelArtLanduseLayer,
  PixelArtParksLayer,
  PixelArtRoadsLayer,
  PixelArtWaterLayer,
  SimpleBackgroundLayer
} from 'pixel-layer';

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://example.com/style.json'
});

map.on('load', () => {
  map.addLayer(new SimpleBackgroundLayer() as any);
  map.addLayer(new PixelArtWaterLayer());
  map.addLayer(new PixelArtLanduseLayer());
  map.addLayer(new PixelArtParksLayer());
  map.addLayer(new PixelArtRoadsLayer());
  map.addLayer(new PixelArtBuildingsLayerSimple());
});
```

Every layer exposes an options object that defaults to the OpenMapTiles schema but allows overriding:

- `source` / `sourceLayer` names
- Property keys used for classifications (e.g. `classProperty`, `heightProperty`, `hide3dProperty`)
- Optional callback hooks such as `classify`, `filter`, or `getBuildingType` to implement custom schemas

Refer to the TypeScript definitions shipped in `dist/types` for the full option surface.

## Demo

Run the local demo that mirrors the published package:

```bash
npm run dev
```

A production build is generated with:

```bash
npm run build:demo
```

The output lives in `dist-demo/` and is uploaded automatically as a workflow artifact.

## Building the Library

```bash
npm run build
```

This command cleans previous artifacts, builds the library bundle (`dist/`), emits declaration files (`dist/types/`), and compiles the demo site (`dist-demo/`). Use `npm pack --dry-run` to inspect the publishing payload.

## Continuous Integration & Publishing

- `.github/workflows/ci.yml` runs on pushes and pull requests. It installs dependencies, builds the library and demo, performs an `npm pack --dry-run`, and uploads the demo assets as an artifact.
- `.github/workflows/publish.yml` can be triggered manually or on GitHub releases and publishes the package to npm once `NPM_TOKEN` is configured in repository secrets.

## Developing New Layers

Library sources live under `src/`. Demo code imports directly from `src/` to dogfood the public API. Keep OpenMapTiles assumptions behind configurable options so downstream projects can adapt the layers to other vector tile schemas.
