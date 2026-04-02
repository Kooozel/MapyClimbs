import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import manifest from "./manifest.json";

export default defineConfig(({ mode }) => ({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // Disable sourcemaps in production — CWS reviewers inspect the zip and
    // sourcemaps expose full original source; omitting them keeps the bundle
    // clean without obfuscating anything.
    sourcemap: mode !== "production",
    rollupOptions: {
      // gpx-interceptor-injected.ts is a web_accessible_resource that crxjs
      // would otherwise copy as raw source. Declaring it as an explicit entry
      // forces Rollup to compile it to the .js file referenced in manifest.json.
      input: {
        "gpx-interceptor-injected": resolve(__dirname, "src/gpx-interceptor-injected.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
  plugins: [crx({ manifest })],
}));
