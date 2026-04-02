/**
 * build.js — Climb Analyzer extension build script
 *
 * Bundles extension/ source into dist/:
 *   content-interceptor.js  ← gpx-interceptor.js          (document_start)
 *   content.js              ← gpx-parser + chart + panel + map-inject (document_idle)
 *   background.js           ← background.js + climb-engine.js (true ESM bundle)
 *   popup.js                ← gpx-parser.js + popup.js
 *   gpx-interceptor-injected.js  ← page-context IIFE (web_accessible_resource)
 *   popup.html / *.css / images/  ← copied / lightly patched
 *   manifest.json           ← patched content_scripts paths
 *
 * Usage:
 *   node build.js           one-shot build
 *   node build.js --watch   rebuild on source changes (esbuild watch mode)
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync, mkdirSync, cpSync } from 'fs';
import { resolve, join } from 'path';

const WATCH = process.argv.includes('--watch');
const SRC = 'extension';
const OUT = 'dist';

// ── Shared esbuild options ────────────────────────────────────────────────────

const shared = {
  platform: 'browser',
  target: 'chrome120',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Concatenate source files (global-scope sharing, no ESM imports needed). */
function concat(...files) {
  return files
    .map(f => readFileSync(join(SRC, f), 'utf8'))
    .join('\n\n');
}

/** Copy and lightly patch static assets into dist/. */
function copyStatics() {
  mkdirSync(OUT, { recursive: true });

  // CSS — straight copy
  for (const f of ['popup.css', 'map-inject.css']) {
    copyFileSync(join(SRC, f), join(OUT, f));
  }

  // popup.html — remove the separate gpx-parser.js script tag (it's baked into
  // the popup.js bundle in dist/)
  const html = readFileSync(join(SRC, 'popup.html'), 'utf8').replace(
    /\s*<script src="gpx-parser\.js"><\/script>/,
    ''
  );
  writeFileSync(join(OUT, 'popup.html'), html);

  // images — recursive copy
  try {
    cpSync(join(SRC, 'images'), join(OUT, 'images'), { recursive: true });
  } catch {
    // no images dir — skip silently
  }
}

/** Write dist/manifest.json with bundled file names. */
function writeManifest() {
  const m = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'));

  // Replace the two content_scripts blocks with their bundled equivalents.
  // Preserve matches / run_at from source; just swap the file lists.
  m.content_scripts = [
    {
      matches: m.content_scripts[0].matches,
      js: ['content-interceptor.js'],
      run_at: 'document_start',
    },
    {
      matches: m.content_scripts[1].matches,
      js: ['content.js'],
      css: ['map-inject.css'],
      run_at: 'document_idle',
    },
  ];

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(m, null, 2));
}

// ── Build entries ─────────────────────────────────────────────────────────────

/**
 * background.js — true ESM bundle; climb-engine.js is resolved via import.
 */
function backgroundEntry() {
  return {
    entryPoints: [join(SRC, 'background.js')],
    bundle: true,
    outfile: join(OUT, 'background.js'),
    format: 'esm',
    ...shared,
  };
}

/**
 * content-interceptor.js — document_start content script.
 * Standalone script; wrap in IIFE to avoid leaking locals.
 */
function interceptorEntry() {
  return {
    entryPoints: [join(SRC, 'gpx-interceptor.js')],
    bundle: true,
    outfile: join(OUT, 'content-interceptor.js'),
    format: 'iife',
    ...shared,
  };
}

/**
 * content.js — document_idle content script bundle.
 *
 * The four files share a global scope (globals are referenced across files
 * without ESM imports).  Concatenate them in load order, then run through
 * esbuild for syntax checks / target transforms.  bundle:false means esbuild
 * treats this as a plain script — no module resolution or tree-shaking — so
 * the global-scope sharing is preserved exactly as before, just in one file.
 */
function contentEntry() {
  return {
    stdin: {
      contents: concat(
        'gpx-parser.js',
        'map-inject-chart.js',
        'map-inject-panel.js',
        'map-inject.js'
      ),
      resolveDir: resolve(SRC),
    },
    bundle: false,
    outfile: join(OUT, 'content.js'),
    ...shared,
  };
}

/**
 * popup.js — popup bundle.
 * gpx-parser.js is concatenated before popup.js (same global-scope trick).
 */
function popupEntry() {
  return {
    stdin: {
      contents: concat('gpx-parser.js', 'popup.js'),
      resolveDir: resolve(SRC),
    },
    bundle: false,
    outfile: join(OUT, 'popup.js'),
    ...shared,
  };
}

/**
 * gpx-interceptor-injected.js — injected into page context via <script> tag.
 * Must be a self-contained IIFE; chrome.* APIs are NOT available here.
 */
function injectedEntry() {
  return {
    entryPoints: [join(SRC, 'gpx-interceptor-injected.js')],
    bundle: true,
    outfile: join(OUT, 'gpx-interceptor-injected.js'),
    format: 'iife',
    ...shared,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  copyStatics();
  writeManifest();

  const entries = [
    backgroundEntry(),
    interceptorEntry(),
    contentEntry(),
    popupEntry(),
    injectedEntry(),
  ];

  if (WATCH) {
    // esbuild watch mode: rebuild each bundle independently on file changes.
    const contexts = await Promise.all(entries.map(e => esbuild.context(e)));
    await Promise.all(contexts.map(ctx => ctx.watch()));
    console.log('Watching for changes… (Ctrl-C to stop)');
  } else {
    await Promise.all(entries.map(e => esbuild.build(e)));
    console.log('Build complete → dist/');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
