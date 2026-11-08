import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // /assets pertenece a las imágenes subidas que sirve la API; los archivos compilados van en /static.
  build: { assetsDir: 'static' },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:4000', '/assets': 'http://127.0.0.1:4000' },
  },
  preview: { host: '127.0.0.1', proxy: { '/api': 'http://127.0.0.1:4000', '/assets': 'http://127.0.0.1:4000' } },
})
