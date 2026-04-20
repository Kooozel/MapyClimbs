/**
 * generate-whats-new.mjs
 *
 * Validates public/whats-new-data.json against the current package.json
 * version and copies it into place for the WXT build.
 *
 * Schema:
 *   {
 *     "version": "1.0.4",
 *     "entries": {
 *       "en": ["First bullet", "Second bullet"],
 *       "cs": ["První bod", "Druhý bod"]
 *     }
 *   }
 *
 * whats-new-data.json is hand-authored with user-facing (plain language)
 * release notes. It is NOT generated from CHANGELOG.md. Update it manually
 * before each release.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dataPath = join(root, "public", "whats-new-data.json");

// ── 1. Read manifest version ──────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;

// ── 2. Read and validate whats-new-data.json ─────────────────────────────────
if (!existsSync(dataPath)) {
  console.error(
    `generate-whats-new: public/whats-new-data.json not found.\n` +
      `Create it manually with user-facing release notes before building.`
  );
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(dataPath, "utf8"));
} catch (e) {
  console.error(`generate-whats-new: Failed to parse public/whats-new-data.json: ${e.message}`);
  process.exit(1);
}

// ── 3. Version check ─────────────────────────────────────────────────────────
if (data.version !== version) {
  console.warn(
    `generate-whats-new: WARNING — whats-new-data.json version (${data.version}) ` +
      `does not match package.json version (${version}).\n` +
      `Update public/whats-new-data.json before publishing.`
  );
}

// ── 4. Structure check ───────────────────────────────────────────────────────
const enEntries = data.entries?.en;
const csEntries = data.entries?.cs;

if (!Array.isArray(enEntries) || enEntries.length === 0) {
  console.error(
    `generate-whats-new: entries.en must be a non-empty array in whats-new-data.json`
  );
  process.exit(1);
}

if (!Array.isArray(csEntries) || csEntries.length === 0) {
  console.warn(
    `generate-whats-new: WARNING — entries.cs is missing or empty in whats-new-data.json.\n` +
      `Czech users will see the English version as fallback.`
  );
}

console.log(
  `generate-whats-new: whats-new-data.json OK — v${data.version}, ` +
    `${enEntries.length} EN bullet(s)${csEntries?.length ? `, ${csEntries.length} CS bullet(s)` : ", no CS translation"}`
);
