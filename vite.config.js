import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  // VERCEL_GIT_COMMIT_SHA is auto-populated by Vercel at build time, no env var setup needed.
  // Used as the Sentry release identifier — see src/main.jsx.
  define: {
    __RELEASE__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || 'dev'),
  },
  optimizeDeps: {
    include: ['exceljs/dist/exceljs.bare.min.js'],
  },
  // 2026-04-12
})
