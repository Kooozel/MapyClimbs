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
 * The built-in scoring models, by name — sugar for the ScoringConfig each one
 * names (scoring.ts). A consumer wanting its own bands passes a config instead
 * of forking: this union is closed and stays closed.
 * - "aso": ASO/Tour de France formula — score = dist(km) × avgGrade²
 * - "garmin": Garmin ClimbPro formula — score = dist(m) × avgGrade(%)
 * - "hiking": TRAILS-GPX formula — score = H²/(8L) + altitude bonus + G_max term
 */
export type ScoringModel = "aso" | "garmin" | "hiking";

/**
 * Raw elevation tuple as produced by gpx.ts.
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
 * A climb as the engine measures it: geometry, and nothing else.
 *
 * No difficulty and no category, because "is this a climb" is the consumer's
 * question and the models disagree substantially about it — over travny.gpx's
 * eight candidates, ASO keeps three, Garmin five and hiking one. A library that
 * answers on the consumer's behalf has to be asked twice (#77).
 */
export interface MeasuredClimb {
  /** Metres, after the flat lead-in and tail are trimmed. */
  distance: number;
  /** Metres gained. */
  elevation: number;
  /** Per cent. */
  avgGrade: number;
  /**
   * Steepest sustained gradient as a decimal (0.25 = 25 %), over
   * MAX_SUSTAINED_GRADIENT_WINDOW_M.
   *
   * Measured here rather than by whoever scores: the hiking model and the CLI's
   * `max_grade` column both want it, so one scan in the pipeline leaves every
   * scorer pure arithmetic over the fields above, with no segment walk of its
   * own. Deliberately not the card's "Max grade" — that is maxPitchGradient
   * over the simplified chart profile (gradient-zones.ts), a steeper figure by
   * construction.
   */
  maxSustainedGradient: number;
  segments: Segment[];
  markerCoords: Coords | null;
  /** Snapped to the raw-profile summit — for every candidate, since the snap
   *  runs before anything scores. */
  endCoords: Coords | null;
}

/**
 * A MeasuredClimb read through one scoring model.
 *
 * `null` is data — "clears no threshold under this model" — not a drop. The
 * consumer filters, with Array.prototype.filter; the engine ships no predicate
 * DSL and no opinion about where the line sits.
 */
export interface ScoredClimb extends MeasuredClimb {
  difficulty: number | null;
  category: ClimbCategory | null;
}

/** Pre-measurement intermediate produced by identifyClimbs / mergeNearbyClimbs. */
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
export interface DetectionResult {
  /** Route-ordered, and *every* candidate the pipeline found — 1 to 24 on the
   *  real routes in test/fixtures, so returning the lot is not a firehose. The
   *  set is invariant across scoring models, which is the evidence that scoring
   *  was never part of detection (#77). */
  climbs: MeasuredClimb[];
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
      /** The pipeline's last decision point. It used to be "categorize" and
       *  carried a difficulty and a category; scoring left the pipeline in #77,
       *  so what remains is the measurement. `maxSustainedGradient` is
       *  deliberately absent: it is only final after the summit snap, and a
       *  figure printed one step before it settles is worse than none. */
      stage: "measure";
      startKm: number;
      endKm: number;
      distanceM: number;
      avgGradePct: number;
    };

export type ClimbDebugSink = (event: ClimbDebugEvent) => void;

export interface DetectClimbsOptions {
  /** Optional structured trace sink. Production callers omit this. */
  debug?: ClimbDebugSink;
}
