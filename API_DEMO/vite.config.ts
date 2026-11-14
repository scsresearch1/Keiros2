import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** Unique per Netlify build so open tabs can detect a new deploy. */
const BUILD_ID =
  process.env.COMMIT_REF ||
  process.env.CACHED_COMMIT_REF ||
  process.env.CF_PAGES_COMMIT_SHA ||
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

function emitBuildId(): Plugin {
  return {
    name: 'keiros-emit-build-id',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-id.json',
        source: JSON.stringify(
          {
            id: BUILD_ID,
            builtAt: new Date().toISOString(),
          },
          null,
          0,
        ),
      })
    },
  }
}

export default defineConfig({
  define: {
    __KEIROS_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react(), emitBuildId()],
  server: {
    port: 5174,
    proxy: {
      // OSM extract — must be before the generic /api → ERP proxy (avoids browser CORS).
      '/api/overpass-kumi': {
        target: 'https://overpass.kumi.systems',
        changeOrigin: true,
        rewrite: () => '/api/interpreter',
      },
      '/api/overpass': {
        target: 'https://overpass-api.de',
        changeOrigin: true,
        rewrite: () => '/api/interpreter',
      },
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
