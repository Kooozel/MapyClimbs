/**
 * scoring.ts — MapyClimbs
 *
 * How a measured climb becomes a difficulty and a category. This is a *view*
 * over what detectClimbs returns, not a step inside it: the engine measures,
 * and whether a given climb clears the bar is the consumer's question (#77).
 *
 * Consumed by the extension's render path (scoring-view.ts), the CLI, and
 * popup.ts, which reads the threshold tables to draw its legend.
 */

import { ClimbCategory } from "./climb-types";
import type { DetectionResult, MeasuredClimb, ScoredClimb, ScoringModel } from "./climb-types";

export interface ScoringThreshold {
  category: ClimbCategory;
  /** Minimum score (inclusive) to qualify for this category. */
  min: number;
}

export interface ScoringConfig {
  /**
   * Raw difficulty for one measured climb.
   *
   * Pure arithmetic over MeasuredClimb's fields, with no segment walk of its
   * own: the pipeline measures `maxSustainedGradient` once, so even the hiking
   * formula — the only one that needs it — is three multiplications here.
   */
  score: (climb: MeasuredClimb) => number;
  /** Ordered HC → lowest category; each entry is the minimum score for that category. */
  thresholds: ReadonlyArray<ScoringThreshold>;
}

/** ASO/Tour de France: score = distance (km) × avgGrade². */
export const ASO: ScoringConfig = {
  score: (climb) => (climb.distance / 1000) * climb.avgGrade * climb.avgGrade,
  thresholds: [
    { category: ClimbCategory.HC, min: 600 },
    { category: ClimbCategory.Cat1, min: 300 },
    { category: ClimbCategory.Cat2, min: 150 },
    { category: ClimbCategory.Cat3, min: 75 },
    { category: ClimbCategory.Cat4, min: 25 },
    { category: ClimbCategory.Uncategorized, min: 8 },
  ],
};

/** Garmin ClimbPro: score = distance (m) × avgGrade (%). */
export const GARMIN: ScoringConfig = {
  score: (climb) => climb.distance * climb.avgGrade,
  thresholds: [
    { category: ClimbCategory.HC, min: 64000 },
    { category: ClimbCategory.Cat1, min: 48000 },
    { category: ClimbCategory.Cat2, min: 32000 },
    { category: ClimbCategory.Cat3, min: 16000 },
    { category: ClimbCategory.Cat4, min: 8000 },
    { category: ClimbCategory.Uncategorized, min: 1500 },
  ],
};

/**
 * TRAILS-GPX: score = H²/(8L) + H×0.002 + G_max×0.5.
 *
 * L is in metres, despite the original spec labelling it "km" — using km
 * produces scores 1 000× the threshold range.
 */
export const HIKING: ScoringConfig = {
  score: (climb) =>
    (climb.elevation * climb.elevation) / (8 * climb.distance) +
    climb.elevation * 0.002 +
    climb.maxSustainedGradient * 0.5,
  thresholds: [
    { category: ClimbCategory.HC, min: 40 },
    { category: ClimbCategory.Cat1, min: 25 },
    { category: ClimbCategory.Cat2, min: 15 },
    { category: ClimbCategory.Cat3, min: 8 },
    { category: ClimbCategory.Cat4, min: 4 },
    { category: ClimbCategory.Uncategorized, min: 0.5 },
  ],
};

/**
 * The built-ins by name. Exported so consumers (popup etc.) can derive display
 * tables from the same thresholds that do the scoring.
 */
export const SCORING_CONFIGS: Readonly<Record<ScoringModel, ScoringConfig>> = {
  aso: ASO,
  garmin: GARMIN,
  hiking: HIKING,
};

/**
 * Score every climb in a detection result under one model.
 *
 * Route order is preserved and nothing is dropped: a climb that clears no
 * threshold comes back with `difficulty: null` and `category: null`, which is
 * the whole point — the caller filters. That makes a scoring-model switch a
 * call to this function rather than a re-partition of stored data, so it costs
 * no storage write and is exactly reversible by construction.
 *
 * `model` takes either a name for a built-in or a ScoringConfig of the caller's
 * own, so wanting different bands does not mean forking the package.
 */
export function score(result: DetectionResult, model: ScoringConfig | ScoringModel): ScoredClimb[] {
  const config = typeof model === "string" ? SCORING_CONFIGS[model] : model;
  return result.climbs.map((climb) => {
    const difficulty = config.score(climb);
    const match = config.thresholds.find((t) => difficulty >= t.min);
    return match
      ? { ...climb, difficulty, category: match.category }
      : { ...climb, difficulty: null, category: null };
  });
}
