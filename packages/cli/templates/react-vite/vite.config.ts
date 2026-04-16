import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

const logger = createLogger()
const originalError = logger.error.bind(logger)
logger.error = (msg, options) => {
  if (msg.includes('EPIPE') || msg.includes('ECONNRESET')) return
  originalError(msg, options)
}

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          proxy.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return
            console.error('api proxy error', err)
          })
        },
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EPIPE' || err.code === 'ECONNRESET') return
            console.error('ws proxy error', err)
          })
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
