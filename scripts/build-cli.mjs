/**
 * build-cli.mjs — bundle the climb engine for use outside the extension.
 *
 * Emits two dependency-free ESM files into dist-cli/:
 *   climb-engine.mjs  the detection engine as a library
 *   climb-cli.mjs     the executable CLI wrapping it
 *
 * The engine's whole transitive closure is local — climb-types.ts, scoring.ts,
 * climb-engine.config.ts, max-gradient.ts, plus gpx.ts and geo.ts behind the
 * reader's own entry point — with no DOM, chrome.*, or third-party imports, so
 * the bundle needs no shims and installs nothing. The CLI additionally imports
 * node: builtins, which are part of the runtime, not dependencies.
 *
 * That closure is asserted here rather than assumed — see ENGINE_CLOSURE below.
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

/**
 * Every file the engine is allowed to pull in. The engine is being extracted as
 * a standalone library (#68), so an import that reaches back into the extension
 * — storage.ts, constants.ts, types.ts, anything under content/ — turns the
 * move from a file copy into a redesign.
 *
 * This is the value-level half of the boundary; tsconfig.engine.json is the
 * other half, compiling these same files with no DOM lib and no ambient types
 * so a stray `document.` or `chrome.` fails there. Neither catches a *type-only*
 * import of an extension type, which esbuild erases and tsc accepts: that one
 * is on review, and on the explicit file list both configs carry.
 */
const ENGINE_CLOSURE = new Set([
  "src/climb-engine.ts",
  "src/climb-engine.config.ts",
  "src/climb-types.ts",
  "src/geo.ts",
  "src/gpx.ts",
  "src/max-gradient.ts",
  "src/scoring.ts",
]);

await rm(OUT_DIR, { recursive: true, force: true });

const engine = await build({
  ...shared,
  entryPoints: ["src/climb-engine.ts"],
  outfile: `${OUT_DIR}/climb-engine.mjs`,
  metafile: true,
});

// Published surface the engine entry point does not reach: the GPX reader
// (#77) and the scorer, which stopped being a pipeline step in the same change.
// `climb-engine.ts` imports neither, so without these the closure check would
// walk right past both. Built for the metafile alone — the CLI bundle already
// inlines them, and how they are finally packaged as entry points is #68's
// fourth decision, not this script's.
const surface = await Promise.all(
  ["src/gpx.ts", "src/scoring.ts"].map((entry) =>
    build({ ...shared, entryPoints: [entry], write: false, metafile: true })
  )
);

const strays = [
  ...new Set([engine, ...surface].flatMap((result) => Object.keys(result.metafile.inputs))),
].filter((file) => !ENGINE_CLOSURE.has(file));
if (strays.length > 0) {
  console.error(
    `The climb engine reached outside its closure (#68):\n` +
      strays.map((f) => `  ${f}`).join("\n") +
      `\n\nEither the import belongs somewhere else, or the file joins the engine —` +
      ` in which case add it to ENGINE_CLOSURE here and to tsconfig.engine.json.`
  );
  process.exit(1);
}

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
