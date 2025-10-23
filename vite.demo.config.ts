import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pixel-layer/',
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    sourcemap: true
  }
});
