import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: '.env.local' })

const release = process.env.VERCEL_GIT_COMMIT_SHA || 'dev'
// Upload is skipped entirely (and no sourcemaps are even generated, see build.sourcemap
// below) unless SENTRY_AUTH_TOKEN is set — keeps local/CI builds without the token safe.
const sentryEnabled = Boolean(process.env.SENTRY_AUTH_TOKEN)

export default defineConfig({
  plugins: [
    react(),
    sentryVitePlugin({
      // org/project/authToken read from SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN env vars.
      disable: !sentryEnabled,
      telemetry: false,
      release: { name: release },
      sourcemaps: {
        // Deletes the .map files from dist/ after upload so they never ship in the public bundle.
        filesToDeleteAfterUpload: ['dist/**/*.map'],
      },
    }),
  ],
  base: './',
  // VERCEL_GIT_COMMIT_SHA is auto-populated by Vercel at build time, no env var setup needed.
  // Used as the Sentry release identifier — see src/main.jsx.
  define: {
    __RELEASE__: JSON.stringify(release),
  },
  build: {
    // 'hidden': map files are generated but not referenced from the built JS (no
    // sourceMappingURL comment) — only Sentry gets them, via the upload above.
    sourcemap: sentryEnabled ? 'hidden' : false,
  },
  optimizeDeps: {
    include: ['exceljs/dist/exceljs.bare.min.js'],
  },
  // 2026-04-12
})
