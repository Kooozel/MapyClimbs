/**
 * index.ts — the climb-engine CLI.
 *
 * Garmin ride GPX in, enriched climb JSON on stdout. The only impure file in
 * src/cli: argument parsing, file reading, and printing live here so the rest
 * stays directly testable.
 *
 * Stdout carries JSON and nothing else, so the command pipes straight into
 * `sync.py --insert-climbs`. Diagnostics go to stderr.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";

import { analyzeRide } from "./analyze-ride";
import { parseZones, DEFAULT_MOVING } from "./ride-metrics";
import type { ScoringModel } from "../climb-types";

const SCORING_MODELS: ScoringModel[] = ["aso", "garmin", "hiking"];

const USAGE = `climb-cli <ride.gpx> [options]

Detect climbs in a Garmin Connect GPX export and print enriched JSON.

Options:
  --model <aso|garmin|hiking>  Scoring model                      (default: aso)
  --zones <a,b,c,d>            Heart-rate zone boundaries in bpm:
                               Z1 <a, Z2 [a,b), Z3 [b,c), Z4 [c,d), Z5 >=d.
                               Omit and pct_z4z5 is null; HR avg/max still emitted.
  --min-speed <m/s>            Moving-time speed floor  (default: ${DEFAULT_MOVING.minSpeedMps})
  --max-gap <s>                Sample gaps at or above this are not moving time
                               (default: ${DEFAULT_MOVING.maxGapSec})
  --include-uncategorized      Emit every candidate, including the ones this
                               model gave no category. Their category and
                               difficulty are null.
  --debug                      Write the climb-detection pipeline trace to
                               stderr as NDJSON (one JSON event per line)
  --pretty                     Indent the JSON
  -h, --help                   Show this help

Zone boundaries are personal data and are never stored in this repo — pass them in.`;

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string" },
      zones: { type: "string" },
      "min-speed": { type: "string" },
      "max-gap": { type: "string" },
      "include-uncategorized": { type: "boolean", default: false },
      debug: { type: "boolean", default: false },
      pretty: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (positionals.length !== 1) {
    throw new Error(
      positionals.length === 0
        ? "expected a GPX file path\n\n" + USAGE
        : `expected exactly one GPX file path, got ${positionals.length}`
    );
  }

  const file = positionals[0];
  const model = (values.model ?? "aso") as ScoringModel;
  if (!SCORING_MODELS.includes(model)) {
    throw new Error(`--model must be one of ${SCORING_MODELS.join(", ")}, got "${values.model}"`);
  }

  const analysis = analyzeRide(readFileSync(file, "utf-8"), {
    source: basename(file),
    model,
    includeUncategorized: values["include-uncategorized"],
    zones: values.zones === undefined ? null : parseZones(values.zones),
    moving: {
      minSpeedMps: positiveNumber(values["min-speed"], DEFAULT_MOVING.minSpeedMps, "--min-speed"),
      maxGapSec: positiveNumber(values["max-gap"], DEFAULT_MOVING.maxGapSec, "--max-gap"),
    },
    // Stdout is a strict JSON contract for sync.py, so the trace goes to
    // stderr — the same channel the top-level error handler already uses.
    debug: values.debug ? (event) => process.stderr.write(`${JSON.stringify(event)}\n`) : undefined,
  });

  process.stdout.write(`${JSON.stringify(analysis, null, values.pretty ? 2 : 0)}\n`);
  return 0;
}

function positiveNumber(raw: string | undefined, fallback: number, flag: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive number, got "${raw}"`);
  }
  return value;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`climb-cli: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
