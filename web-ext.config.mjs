/**
 * web-ext.config.mjs — web-ext configuration for Climb Analyzer
 *
 * All web-ext commands (run / lint / build) default to dist/ as the source.
 * Pass --config=web-ext.config.mjs explicitly when running web-ext directly,
 * or use the npm scripts which include it automatically.
 *
 * Dev workflow:
 *   npm run build          one-shot build into dist/
 *   npm run build --watch  rebuild on changes + manually reload extension
 *   npm run dev            build once then launch Chrome with extension loaded
 *   npm run pack           build + zip into web-ext-artifacts/ for Web Store upload
 *
 * For --watch + auto-reload use two terminals:
 *   terminal 1: node build.js --watch
 *   terminal 2: web-ext run --config=web-ext.config.mjs
 */

export default {
  sourceDir: './dist',
  artifactsDir: './web-ext-artifacts',

  build: {
    overwriteDest: true,
  },

  run: {
    // Target Chromium/Chrome for local dev.
    // Override the binary path if Chrome is not on PATH:
    //   web-ext run --chromium-binary "C:\Program Files\Google\Chrome\Application\chrome.exe"
    target: ['chromium'],
    startUrl: ['https://mapy.cz/'],
  },
};
