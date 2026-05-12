/**
 * scoring.ts — MapyClimbs
 * Scoring model definitions: formulas, thresholds, and the shared applyScore helper.
 * Consumed by climb-engine.ts (detection pipeline) and popup.ts (display).
 */

import { ClimbCategory } from "./types";
import type { ScoringModel } from "./types";

export interface ScoringThreshold {
  category: ClimbCategory;
  /** Minimum score (inclusive) to qualify for this category. */
  min: number;
}

export interface ScoringConfig {
  /** Compute the raw difficulty score from distance in metres and average grade (%). */
  score: (distanceM: number, avgGrade: number) => number;
  /** Ordered HC → lowest category; each entry is the minimum score for that category. */
  thresholds: ReadonlyArray<ScoringThreshold>;
  /** Minimum climb distance (m) for this model — shorter climbs return null. */
  minDistanceM: number;
  /** Minimum average grade (%) for this model — gentler climbs return null. */
  minAvgGradePct: number;
}

/**
 * Single source of truth for every scoring model's formula + category thresholds.
 * Exported so consumers (popup etc.) can derive display tables from it.
 */
export const SCORING_CONFIGS: Readonly<Record<Exclude<ScoringModel, "hiking">, ScoringConfig>> = {
  aso: {
    // ASO/Tour de France: score = distance (km) × avgGrade²
    score: (distanceM, avgGrade) => (distanceM / 1000) * avgGrade * avgGrade,
    minDistanceM: 300,
    minAvgGradePct: 2,
    thresholds: [
      { category: ClimbCategory.HC, min: 600 },
      { category: ClimbCategory.Cat1, min: 300 },
      { category: ClimbCategory.Cat2, min: 150 },
      { category: ClimbCategory.Cat3, min: 75 },
      { category: ClimbCategory.Cat4, min: 8 },
      { category: ClimbCategory.Uncategorized, min: 4.5 },
    ],
  },
  garmin: {
    // Garmin ClimbPro: score = distance (m) × avgGrade (%)
    score: (distanceM, avgGrade) => distanceM * avgGrade,
    minDistanceM: 300,
    minAvgGradePct: 2,
    thresholds: [
      { category: ClimbCategory.HC, min: 64000 },
      { category: ClimbCategory.Cat1, min: 48000 },
      { category: ClimbCategory.Cat2, min: 32000 },
      { category: ClimbCategory.Cat3, min: 16000 },
      { category: ClimbCategory.Cat4, min: 8000 },
      { category: ClimbCategory.Uncategorized, min: 1500 },
    ],
  },
};

// ── Hiking scorer ────────────────────────────────────────────────

export interface HikingScoreInput {
  /** Total elevation gain of the climb (m). */
  totalElevationM: number;
  /** Total climb distance (m). */
  totalDistanceM: number;
  /** Summit elevation above sea level (m). */
  summitElevationM: number;
  /** Maximum sustained gradient over any 200 m window, as a decimal (0.25 = 25%). */
  maxGradientDecimal: number;
}

/**
 * formula (roughness held at 1.0 for V1):
 *   score = H²/(8L) + max(0, T−1500)×0.15 + H×0.002 + G_max×0.5
 *
 * L is in metres (despite the original spec labelling it "km" — using km
 * produces scores 1 000× the threshold range).
 */
export const HIKING_THRESHOLDS: ReadonlyArray<ScoringThreshold> = [
  { category: ClimbCategory.HC, min: 40 },
  { category: ClimbCategory.Cat1, min: 25 },
  { category: ClimbCategory.Cat2, min: 15 },
  { category: ClimbCategory.Cat3, min: 8 },
  { category: ClimbCategory.Cat4, min: 4 },
  { category: ClimbCategory.Uncategorized, min: 0.5 },
];

export const HIKING_MIN_DISTANCE_M = 200;
export const HIKING_MIN_AVG_GRADE_PCT = 3;

export function applyHikingScore(
  input: HikingScoreInput,
  distanceM: number,
  avgGrade: number
): { difficulty: number; category: ClimbCategory } | null {
  if (distanceM < HIKING_MIN_DISTANCE_M || avgGrade < HIKING_MIN_AVG_GRADE_PCT) return null;

  const {
    totalElevationM: H,
    totalDistanceM: L,
    summitElevationM: T,
    maxGradientDecimal: gMax,
  } = input;

  const difficulty = (H * H) / (8 * L) + Math.max(0, T - 1500) * 0.15 + H * 0.002 + gMax * 0.5;

  const match = HIKING_THRESHOLDS.find((t) => difficulty >= t.min);
  if (!match) return null;
  return { difficulty, category: match.category };
}

// ── Cycling scorer ────────────────────────────────────────────────────────────

/**
 * Compute difficulty score and category for a climb.
 * Returns null when the climb doesn't meet the model's geometric minimums
 * (distance, average grade) or when the score falls below the lowest threshold.
 */
export function applyScore(
  distanceM: number,
  avgGrade: number,
  model: Exclude<ScoringModel, "hiking">
): { difficulty: number; category: ClimbCategory } | null {
  const cfg = SCORING_CONFIGS[model];
  if (distanceM < cfg.minDistanceM || avgGrade < cfg.minAvgGradePct) return null;
  const difficulty = cfg.score(distanceM, avgGrade);
  const match = cfg.thresholds.find((t) => difficulty >= t.min);
  if (!match) return null;
  return { difficulty, category: match.category };
}
