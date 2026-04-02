import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import { resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import manifest from "./manifest.json";

export default defineConfig({
  root: "src",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      // crxjs doesn't compile .ts files in web_accessible_resources — it copies
      // them as raw source. Adding gpx-interceptor-injected.ts as an explicit
      // entry forces Rollup to compile it. The closeBundle plugin below then
      // patches the dist manifest to reference the compiled .js file.
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
  plugins: [
    crx({ manifest }),
    {
      name: "patch-injected-war",
      closeBundle() {
        const distManifest = resolve(process.cwd(), "dist/manifest.json");
        const m = JSON.parse(readFileSync(distManifest, "utf-8")) as {
          web_accessible_resources?: Array<{ resources: string[] }>;
        };
        for (const entry of m.web_accessible_resources ?? []) {
          const i = entry.resources.indexOf("gpx-interceptor-injected.ts");
          if (i !== -1) entry.resources[i] = "gpx-interceptor-injected.js";
        }
        writeFileSync(distManifest, JSON.stringify(m, null, 2));
      },
    },
  ],
});
