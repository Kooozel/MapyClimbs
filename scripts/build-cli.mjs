/**
 * build-cli.mjs — bundle the climb engine for use outside the extension.
 *
 * Emits two dependency-free ESM files into dist-cli/:
 *   climb-engine.mjs  the detection engine as a library
 *   climb-cli.mjs     the executable CLI wrapping it
 *
 * The engine's whole transitive closure is local (types.ts, scoring.ts,
 * climb-engine.config.ts) with no DOM, chrome.*, or third-party imports, so
 * the bundle needs no shims and installs nothing. The CLI additionally imports
 * node: builtins, which are part of the runtime, not dependencies.
 *
 * Output goes to dist-cli/ rather than dist/ to stay clear of `wxt build`.
 */

import { build } from "esbuild";
import { rm, stat } from "node:fs/promises";

const OUT_DIR = "dist-cli";

const shared = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  packages: "bundle",
  logLevel: "warning",
};

await rm(OUT_DIR, { recursive: true, force: true });

await build({
  ...shared,
  entryPoints: ["src/climb-engine.ts"],
  outfile: `${OUT_DIR}/climb-engine.mjs`,
});

await build({
  ...shared,
  entryPoints: ["src/cli/index.ts"],
  outfile: `${OUT_DIR}/climb-cli.mjs`,
  banner: { js: "#!/usr/bin/env node" },
});

for (const name of ["climb-engine.mjs", "climb-cli.mjs"]) {
  const { size } = await stat(`${OUT_DIR}/${name}`);
  console.log(`${OUT_DIR}/${name}  ${(size / 1024).toFixed(1)} KB`);
}
