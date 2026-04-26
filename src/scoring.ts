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
}

/**
 * Single source of truth for every scoring model's formula + category thresholds.
 * Exported so consumers (popup etc.) can derive display tables from it.
 */
export const SCORING_CONFIGS: Readonly<Record<ScoringModel, ScoringConfig>> = {
  aso: {
    // ASO/Tour de France: score = distance (km) × avgGrade²
    score: (distanceM, avgGrade) => (distanceM / 1000) * avgGrade * avgGrade,
    thresholds: [
      { category: ClimbCategory.HC, min: 600 },
      { category: ClimbCategory.Cat1, min: 300 },
      { category: ClimbCategory.Cat2, min: 150 },
      { category: ClimbCategory.Cat3, min: 75 },
      { category: ClimbCategory.Cat4, min: 0 },
    ],
  },
  garmin: {
    // Garmin ClimbPro: score = distance (m) × avgGrade (%)
    score: (distanceM, avgGrade) => distanceM * avgGrade,
    thresholds: [
      { category: ClimbCategory.HC, min: 64000 },
      { category: ClimbCategory.Cat1, min: 48000 },
      { category: ClimbCategory.Cat2, min: 32000 },
      { category: ClimbCategory.Cat3, min: 16000 },
      { category: ClimbCategory.Cat4, min: 0 },
    ],
  },
};

/**
 * Compute difficulty score and category for a climb.
 * Returns null when the score falls below the model's minimum detection threshold.
 */
export function applyScore(
  distanceM: number,
  avgGrade: number,
  model: ScoringModel
): { difficulty: number; category: ClimbCategory } | null {
  const cfg = SCORING_CONFIGS[model];
  const difficulty = cfg.score(distanceM, avgGrade);
  const match = cfg.thresholds.find((t) => difficulty >= t.min);
  if (!match) return null;
  return { difficulty, category: match.category };
}
