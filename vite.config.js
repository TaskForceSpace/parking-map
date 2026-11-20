import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.js', import.meta.url)),
      formats: ['es'],
      fileName: 'parking-map',
      cssFileName: 'parking-map',
    },
    rollupOptions: {
      external: ['vue', 'leaflet'],
    },
  },
});
