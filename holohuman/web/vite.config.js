import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8710',
      '/models': 'http://localhost:8710',
    },
  },
})
