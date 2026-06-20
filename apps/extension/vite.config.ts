import { defineConfig } from 'vite'

// MV3-friendly build: relative base, and no module-preload polyfill (that polyfill
// is an inline script, which the extension CSP forbids). public/manifest.json is
// copied to the dist root by Vite.
export default defineConfig({
  base: './',
  build: {
    modulePreload: { polyfill: false },
    target: 'es2022',
  },
})
