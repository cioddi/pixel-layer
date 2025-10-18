import { defineConfig } from 'vite';
import path from 'node:path';

const entry = path.resolve(process.cwd(), 'src/index.ts');

export default defineConfig({
  build: {
    lib: {
      entry,
      name: 'PixelLayer',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs')
    },
    rollupOptions: {
      external: ['maplibre-gl', 'earcut', 'gl-matrix'],
      output: {
        globals: {
          'maplibre-gl': 'maplibregl',
          earcut: 'earcut',
          'gl-matrix': 'glMatrix'
        }
      }
    },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    copyPublicDir: false
  }
});
