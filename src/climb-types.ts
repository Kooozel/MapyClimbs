/**
 * climb-types.ts — the climb engine's domain vocabulary.
 *
 * These travel with the engine when it is extracted (#68). Nothing here may
 * reference the extension: no StorageKey, no chrome.runtime message shape, no
 * global augmentation. Two checks keep that true: tsconfig.engine.json compiles
 * the closure with no DOM lib and no ambient types, and scripts/build-cli.mjs
 * asserts the module graph esbuild walks stays inside it.
 */

/**
 * Climb difficulty category — enum-like const so callers can reference values
 * as `ClimbCategory.HC` etc. while the type still resolves to the string union
 * used throughout storage and the UI.
 */
export const ClimbCategory = {
  HC: "HC",
  Cat1: "1",
  Cat2: "2",
  Cat3: "3",
  Cat4: "4",
  Uncategorized: "uncategorized",
} as const;
export type ClimbCategory = (typeof ClimbCategory)[keyof typeof ClimbCategory];

/**
 * Scoring model used to classify climbs.
 * - "aso": ASO/Tour de France formula — score = dist(km) × avgGrade²
 * - "garmin": Garmin ClimbPro formula — score = dist(m) × avgGrade(%)
 * - "hiking": TRAILS-GPX formula — score = H²/(8L) + altitude bonus + G_max term
 */
export type ScoringModel = "aso" | "garmin" | "hiking";

/**
 * Raw elevation tuple as produced by gpx-parser.
 * [distance_m, elevation_m, lat, lon]
 */
export type ElevationTuple = [number, number, number, number];

/** Intermediate GPS point used within the climb-detection pipeline. */
export interface GpsPoint {
  distance: number;
  elevation: number;
  lat: number | null;
  lon: number | null;
}

/** A single gradient segment between two consecutive GPS points. */
export interface Segment {
  startDistance: number;
  endDistance: number;
  distance: number;
  elevation: number;
  gradient: number;
  startElevation: number;
  endElevation: number;
  startLat: number | null;
  startLon: number | null;
  endLat: number | null;
  endLon: number | null;
}

/** WGS-84 coordinate pair. */
export interface Coords {
  lat: number;
  lon: number;
}

/**
 * Fully processed and categorized climb — the public output of detectClimbs.
 * Also used as the shape stored in chrome.storage.
 */
export interface Climb {
  distance: number;
  elevation: number;
  avgGrade: number;
  difficulty: number;
  category: ClimbCategory;
  segments: Segment[];
  markerCoords: Coords | null;
  endCoords: Coords | null;
}

/** Pre-categorization intermediate produced by identifyClimbs / mergeNearbyClimbs. */
export interface RawClimb {
  segments: Segment[];
  totalDistance: number;
  totalElevation: number;
}

/**
 * What detectClimbs returns. Deliberately carries no clock and no transport
 * mode: the engine is deterministic, so identical input gives identical output.
 * The extension decorates it with both on the way to storage — see
 * StoredAnalysisResult in types.ts.
 */
export interface AnalysisResult {
  climbs: Climb[];
  /** Candidates this model scored as null. Together with `climbs` — each of which
   *  carries its own segments — these partition the full trimmed-candidate set that
   *  recategorizeResult replays on a model switch, so no climb's geometry is stored
   *  twice. Absent when nothing was rejected. */
  droppedCandidates?: RawClimb[];
  /** @deprecated Pre-split encoding: the *whole* candidate set, including a copy of
   *  every scored climb's segments. Read-only, for results stored before the split;
   *  never written again, so a stored result self-heals on its next re-analysis. */
  candidates?: RawClimb[];
  totalDistance: number;
  totalElevationGain: number;
  totalElevationLoss: number;
}

/**
 * Structured pipeline-trace event emitted by detectClimbs when a debug sink is
 * passed. Each variant corresponds to one decision point in the 5-step pipeline.
 * The extension never passes a sink, so the engine stays a no-op there; the
 * consumers are `climb-cli --debug` and DEBUG_PIPELINE=1 in the integration test.
 */
export type ClimbDebugEvent =
  | {
      stage: "pipeline";
      rawPoints: number;
      resampled: number;
      interpolated: number;
      smoothed: number;
      segments: number;
    }
  | {
      stage: "identify-candidate";
      index: number;
      startKm: number;
      endKm: number;
      distanceM: number;
      elevationM: number;
      avgGradePct: number;
      rawGainM: number;
    }
  | {
      stage: "identify-close";
      reason: "descent" | "flat";
      atKm: number;
      tailTrimGradePct: number;
    }
  | {
      /** Emitted when tail-trimming leaves a candidate with no segments. No
       *  route fixture currently triggers it; it stays because the path is
       *  reachable and silence there would be the confusing outcome. */
      stage: "identify-reject";
      reason: "empty";
      startKm: number;
      endKm: number;
    }
  | {
      stage: "merge-pair";
      prevStartKm: number;
      prevEndKm: number;
      currStartKm: number;
      currEndKm: number;
      gapM: number;
      valleyDropM: number;
      effectiveMaxGapM: number;
      maxAllowedDropM: number;
      coherentAscent: boolean;
      combinedRawRiseM: number;
      decision: "merge" | "skip";
      /** Which arm of the decision fired. Typed rather than free-form so a
       *  `jq 'select(.reason=="…")'` filter over the CLI's NDJSON is
       *  checkable against this union. */
      reason: "within-gap-and-valley" | "negative-gap" | "gap-too-large" | "valley-too-deep";
    }
  | {
      stage: "trim";
      startKm: number;
      endKm: number;
      droppedHeadSegs: number;
      droppedTailSegs: number;
      remainingDistanceM: number;
      kept: boolean;
    }
  | {
      stage: "categorize";
      startKm: number;
      endKm: number;
      distanceM: number;
      avgGradePct: number;
      difficulty: number | null;
      category: ClimbCategory | null;
    };

export type ClimbDebugSink = (event: ClimbDebugEvent) => void;

export interface DetectClimbsOptions {
  /** Optional structured trace sink. Production callers omit this. */
  debug?: ClimbDebugSink;
}
