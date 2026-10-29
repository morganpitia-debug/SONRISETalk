import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiTarget = process.env.VITE_API_URL || `http://localhost:${process.env.PORT || 3001}`

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('livekit-client')) {
              return 'livekit'
            }
            if (id.includes('libphonenumber-js')) {
              return 'phone-validator'
            }
            if (id.includes('@simplewebauthn')) {
              return 'webauthn'
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react-vendor'
            }
            if (id.includes('socket.io-client')) {
              return 'socket'
            }
          }
        },
      },
    },
  },
})
