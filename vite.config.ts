import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { labSaves } from './scripts/labSavePlugin.mjs';
export default defineConfig({
  plugins: [react(), labSaves()],
  build: {
    chunkSizeWarningLimit: 1100,
    rollupOptions: { output: { manualChunks: { three: ['three', '@react-three/fiber'] } } },
  },
});
