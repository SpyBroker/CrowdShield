import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
      '/toggle-surge': 'http://localhost:8000',
      '/report-incident': 'http://localhost:8000',
      '/incidents': 'http://localhost:8000',
      '/status': 'http://localhost:8000',
    }
  },
  build: {
    outDir: '../frontend',
    emptyOutDir: true,
  }
})
