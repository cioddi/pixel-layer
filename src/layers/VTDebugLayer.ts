import type maplibregl from 'maplibre-gl';
import { MAPLIBRE_TILE_EXTENT } from '../utils/vectorTile';

const TILE_EXTENT = MAPLIBRE_TILE_EXTENT;

interface TileLabel {
  element: HTMLDivElement;
}

export interface VTDebugLayerOptions {
  id?: string;
  lineColor?: [number, number, number, number];
  lineWidth?: number;
  showLabels?: boolean;
  sources?: string[];
}

export class VTDebugLayer implements maplibregl.CustomLayerInterface {
  id: string;
  type: 'custom';
  renderingMode: '2d';

  private map?: maplibregl.Map;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private aPos?: number;
  private uMatrix?: WebGLUniformLocation | null;
  private lineColor: [number, number, number, number];
  private lineWidth: number;
  private showLabels: boolean;
  private sources?: Set<string>;
  private labelsContainer?: HTMLDivElement;
  private labels: Map<string, TileLabel> = new Map();

  constructor(options: VTDebugLayerOptions = {}) {
    this.id = options.id ?? 'vt-debug-layer';
    this.type = 'custom';
    this.renderingMode = '2d';
    this.lineColor = options.lineColor ?? [1, 0, 0, 1];
    this.lineWidth = options.lineWidth ?? 1;
    this.showLabels = options.showLabels ?? true;
    this.sources = options.sources ? new Set(options.sources) : undefined;
  }

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext) {
    this.map = map;

    const vertexSource = `
      attribute vec2 a_pos;
      uniform mat4 u_matrix;
      void main() {
        gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision mediump float;
      uniform vec4 u_color;
      void main() {
        gl_FragColor = u_color;
      }
    `;

    const vertexShader = this.compileShader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) throw new Error('VTDebugLayer: unable to create shader program');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'unknown error';
      throw new Error(`VTDebugLayer: failed to link program: ${info}`);
    }

    this.program = program;
    this.aPos = gl.getAttribLocation(program, 'a_pos');
    this.uMatrix = gl.getUniformLocation(program, 'u_matrix');
    const uColor = gl.getUniformLocation(program, 'u_color');

    const vertices = new Float32Array([
      0, 0,
      TILE_EXTENT, 0,
      TILE_EXTENT, TILE_EXTENT,
      0, TILE_EXTENT
    ]);
    this.buffer = gl.createBuffer() || undefined;
    if (!this.buffer) throw new Error('VTDebugLayer: unable to create buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    if (uColor) {
      gl.useProgram(program);
      gl.uniform4fv(uColor, this.lineColor);
    }

    if (this.showLabels) {
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.top = '0';
      container.style.left = '0';
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.pointerEvents = 'none';
      container.style.fontFamily = 'monospace';
      container.style.fontSize = '11px';
      container.style.color = '#ff0';
      container.style.textShadow = '0 0 2px #000';
      container.style.zIndex = '1000';
      this.labelsContainer = container;
      map.getContainer().appendChild(container);
    }
  }

  onRemove(_map: maplibregl.Map, gl: WebGLRenderingContext) {
    if (this.buffer) {
      gl.deleteBuffer(this.buffer);
      this.buffer = undefined;
    }
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = undefined;
    }
    if (this.labelsContainer) {
      this.labelsContainer.remove();
      this.labelsContainer = undefined;
      this.labels.clear();
    }
    this.map = undefined;
  }

  prerender() {
    // no-op
  }

  render(gl: WebGLRenderingContext, _matrixOrOptions: number[] | maplibregl.CustomRenderMethodInput) {
    if (!this.map || !this.program || this.aPos === undefined || !this.buffer) return;

    const tiles = this.collectTiles();
    if (!tiles.length) {
      this.clearLabels();
      return;
    }

    const depthWasEnabled = gl.isEnabled(gl.DEPTH_TEST);
    const blendWasEnabled = gl.isEnabled(gl.BLEND);
    const prevLineWidth = gl.getParameter(gl.LINE_WIDTH);

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.lineWidth > 0) {
      gl.lineWidth(this.lineWidth);
    }

    const transform: any = (this.map as any).transform;

    for (const tile of tiles) {
      const posMatrix64 = transform.calculatePosMatrix(tile, false, true);
      const posMatrix = posMatrix64 instanceof Float32Array ? posMatrix64 : new Float32Array(posMatrix64);
      if (this.uMatrix) {
        gl.uniformMatrix4fv(this.uMatrix, false, posMatrix);
      }
      gl.drawArrays(gl.LINE_LOOP, 0, 4);
    }

    if (this.showLabels) {
      this.updateLabels(tiles);
    }

    if (depthWasEnabled) gl.enable(gl.DEPTH_TEST); else gl.disable(gl.DEPTH_TEST);
    if (blendWasEnabled) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
    gl.lineWidth(prevLineWidth);

    this.map.triggerRepaint();
  }

  private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('VTDebugLayer: unable to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? 'unknown error';
      throw new Error(`VTDebugLayer: failed to compile shader: ${info}`);
    }
    return shader;
  }

  private collectTiles(): any[] {
    if (!this.map) return [];
    const tiles: any[] = [];
    const seen = new Set<string>();
    const style: any = (this.map as any).style;
    const sourceCaches = style?._renderedSources ?? style?.sourceCaches;
    if (!sourceCaches) return tiles;

    for (const sourceId in sourceCaches) {
      if (this.sources && !this.sources.has(sourceId)) continue;
      const cache = sourceCaches[sourceId];
      const cacheTiles = cache._tiles ?? {};
      for (const key in cacheTiles) {
        const tile = cacheTiles[key];
        const id = tile.tileID ?? tile.canonical;
        if (!id) continue;
        const canonical = id.canonical ?? id;
        const tileKey = `${canonical.z}/${canonical.x}/${canonical.y}`;
        if (seen.has(tileKey)) continue;
        seen.add(tileKey);
        tiles.push(id);
      }
    }
    return tiles;
  }

  private updateLabels(tiles: any[]) {
    if (!this.map || !this.labelsContainer) return;
    const active = new Set<string>();

    for (const tile of tiles) {
      const canonical = tile.canonical ?? tile;
      const key = `${canonical.z}/${canonical.x}/${canonical.y}`;
      active.add(key);

      let label = this.labels.get(key);
      if (!label) {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.transform = 'translate(-50%, -50%)';
        this.labelsContainer.appendChild(div);
        label = { element: div };
        this.labels.set(key, label);
      }
      label.element.textContent = key;

      const center = this.tileIDToLngLat(canonical);
      const projected = this.map.project(center);
      label.element.style.left = `${projected.x}px`;
      label.element.style.top = `${projected.y}px`;
    }

    for (const [key, value] of this.labels) {
      if (!active.has(key)) {
        value.element.remove();
        this.labels.delete(key);
      }
    }
  }

  private clearLabels() {
    if (!this.labelsContainer) return;
    for (const label of this.labels.values()) {
      label.element.remove();
    }
    this.labels.clear();
  }

  private tileIDToLngLat(tileID: { z: number; x: number; y: number }) {
    const z = tileID.z;
    const x = tileID.x + 0.5;
    const y = tileID.y + 0.5;
    const n = Math.pow(2, z);
    const lng = (x / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
    const lat = (latRad * 180) / Math.PI;
    return { lng, lat };
  }
}
