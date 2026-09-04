/**
 * scoring-view.ts — where the extension decides what counts as a climb.
 *
 * The engine measures every candidate and judges none of them (#77), so this
 * is the seam on this side: score the stored result under the user's model,
 * keep the climbs that cleared a threshold, and hand the panel and the overlay
 * the same shape they have always rendered.
 *
 * It is also the whole of what a scoring-model switch does now. It used to be a
 * storage operation — read every result key across every tab and alternative,
 * re-partition, write them all back — and it is a call to `score()` over an
 * array already in memory. No write, no round trip, nothing to keep consistent.
 */

import { score } from "./scoring";
import type { ScoringModel } from "./climb-types";
import type { CategorizedClimb, ScoredAnalysisResult, StoredAnalysisResult } from "./types";

/**
 * The model a result is actually scored with.
 *
 * A hiking route always uses the hiking model regardless of the user's
 * preference (#18): the preference is a choice between two *cycling* formulas,
 * and the popup does not offer hiking at all.
 */
export function effectiveModel(
  result: Pick<StoredAnalysisResult, "routeMode">,
  preference: ScoringModel
): ScoringModel {
  return result.routeMode === "hiking" ? "hiking" : preference;
}

/** Score a stored (measured) result and keep only the categorised climbs. */
export function scoreForDisplay(
  stored: StoredAnalysisResult,
  preference: ScoringModel
): ScoredAnalysisResult {
  const climbs = score(stored, effectiveModel(stored, preference)).filter(
    (climb): climb is CategorizedClimb => climb.category !== null
  );
  return { ...stored, climbs };
}
