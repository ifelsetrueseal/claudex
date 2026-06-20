import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the build can be served from any subpath (e.g. GitHub Pages
  // project sites at /<repo>/).
  base: './',
})
