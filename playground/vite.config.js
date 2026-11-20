import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: command === 'serve'
      ? [
          { find: 'parking-map/style.css', replacement: fileURLToPath(new URL('../src/editor.css', import.meta.url)) },
          { find: 'parking-map', replacement: fileURLToPath(new URL('../src/index.js', import.meta.url)) },
        ]
      : [],
  },
}));
