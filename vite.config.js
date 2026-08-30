import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '0.0.0.0', port: 5173, strictPort: false },
  preview: { host: '0.0.0.0', port: 4173 },
  build: { outDir: 'dist', target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 2000 },
});
