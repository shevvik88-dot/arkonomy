import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: {
    include: ['exceljs/dist/exceljs.bare.min.js'],
  },
  // 2026-04-12
})
