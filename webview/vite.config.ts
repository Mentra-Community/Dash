import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/webview/',
  plugins: [react()],
  build: {
    // Output directory for the production build
    outDir: 'dist',
    // Sourcemaps for easier debugging
    sourcemap: true,
  },
}) 