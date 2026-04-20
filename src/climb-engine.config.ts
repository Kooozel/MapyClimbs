/**
 * climb-engine.config.ts — MapyClimbs
 *
 * All numeric thresholds and tuning constants for the climb-detection pipeline.
 * Adjust values here to change algorithm behaviour without touching the logic.
 */

// ── Resampling (Step 2) ───────────────────────────────────────────────────────

/** Minimum distance (m) between two consecutive profile points after resampling. */
export const RESAMPLE_MIN_INTERVAL_M = 12;

// ── Smoothing — gradient estimation window (Step 3, Pass 1) ──────────────────

/** Half-width (m) of the window used to estimate local gradient magnitude. */
export const SMOOTH_GRAD_WINDOW_M = 200;

// ── Smoothing — adaptive rolling-average window (Step 3, Pass 2) ─────────────

/** Grade (fraction) above which the narrowest smoothing window is applied. */
export const SMOOTH_STEEP_GRADE_THRESHOLD = 0.08;
/** Grade (fraction) below which interpolation shifts toward the widest window. */
export const SMOOTH_MID_GRADE_THRESHOLD = 0.03;
/** Narrowest rolling-average window in metres (used on steep segments). */
export const SMOOTH_WINDOW_MIN_M = 50;
/** Rolling-average window (m) at the mid-grade boundary. */
export const SMOOTH_WINDOW_MID_M = 150;
/** Widest rolling-average window in metres (used on flat segments). */
export const SMOOTH_WINDOW_MAX_M = 250;

// ── Noise spike filter (Step 3, Pass 3) ──────────────────────────────────────

/** Gradient (fraction) that flags a point as a potential spike. */
export const SPIKE_GRADIENT_THRESHOLD = 0.12;
/** Gradient (fraction) the neighbouring segment must be below to confirm a spike. */
export const SPIKE_NEIGHBOR_THRESHOLD = 0.08;

// ── Climb identification (Step 4) ─────────────────────────────────────────────

/** Gradient (%) at or above which a new climb candidate begins. */
export const CLIMB_START_GRADE_PCT = 4;
/** Minimum total distance (m) for a climb candidate to be kept. */
export const CLIMB_MIN_DISTANCE_M = 300;
/** Minimum total elevation gain (m) for a climb candidate to be kept. */
export const CLIMB_MIN_ELEVATION_M = 30;
/** Minimum average gradient (%) for a climb candidate to be kept. */
export const CLIMB_MIN_AVG_GRADE_PCT = 2;
/** Gradient (%) at or below which a segment counts as a descent. */
export const DESCENT_END_GRADE_PCT = -1;
/** Accumulated descent distance (m) that ends the current climb candidate. */
export const DESCENT_END_DISTANCE_M = 150;
/** Accumulated flat/low-grade distance (m, grade < CLIMB_START_GRADE_PCT) that ends the current
 *  climb candidate. Prevents a brief 2%+ ramp at the start of a long flat section from absorbing
 *  every subsequent climb into one low-average-grade candidate. Keeping this small enough means
 *  distinct climbs separated by ~1 km of flat terrain are still identified as separate candidates,
 *  while the gain-scaled merge step can later re-join climbs that deserve it. */
export const CLIMB_END_FLAT_M = 700;

// ── Climb merging (Step 4 cont.) ─────────────────────────────────────────────
//
// Gap distance uses a two-part formula:
//   effectiveMaxGap = MERGE_MAX_GAP_M + min(combinedGain × MERGE_GAP_GAIN_SCALE, MERGE_GAP_MAX_BONUS_M)
//
// CLIMB_END_FLAT_M (above) creates a real distance gap between raw climb candidates
// when a long flat section ends a climb. MERGE_GAP_GAIN_SCALE then decides whether
// that gap is small enough relative to the combined elevation gain to justify merging.

/** Base maximum gap (m) between two climbs that can be merged. Gain-scaling extends this. */
export const MERGE_MAX_GAP_M = 1200;
/** Metres of extra merge-gap allowance per metre of combined elevation gain. */
export const MERGE_GAP_GAIN_SCALE = 2.0;
/** Cap on the gain-based bonus (m), keeping total effective gap from growing unbounded. */
export const MERGE_GAP_MAX_BONUS_M = 4000;
/** Tighter base gap (m) used when the terrain in the gap *descends* in the raw profile.
 *  Prevents merging two climbs across a genuine valley when the gap distance would
 *  otherwise be within MERGE_MAX_GAP_M. Ascending/flat gaps keep the full base.
 *  The effective cap is max(MERGE_DESCENT_GAP_MAX_M, smallerGain × MERGE_DESCENT_SCALE)
 *  so large high-gain climbs can still bridge longer descent gaps (e.g. a levelling
 *  section mid-mountain). */
export const MERGE_DESCENT_GAP_MAX_M = 400;
export const MERGE_DESCENT_SCALE = 4;
/** Absolute maximum valley drop (m) allowed between two merged climbs. */
export const MERGE_MAX_VALLEY_DROP_M = 20;
/** Combined-gain fraction used to compute the relative valley-drop limit. */
export const MERGE_VALLEY_RATIO = 0.2;

// ── Endpoint trimming (Step 5) ────────────────────────────────────────────────

/** Gradient (%) below which leading/trailing segments are trimmed.
 *  Must match CLIMB_START_GRADE_PCT so identification and trimming use the same boundary. */
export const TRIM_MIN_GRADE_PCT = 4;
/** Backward look-behind window (m) used to judge whether a candidate end-segment lies in a
 *  genuinely steep zone. At each candidate endIndex the algorithm sums the steep and total
 *  distance of the last TRIM_TAIL_WINDOW_M metres. If the steep fraction is below
 *  TRIM_STEEP_RATIO the segment is treated as an isolated noise spike and discarded. */
export const TRIM_TAIL_WINDOW_M = 200;
/** Minimum fraction of TRIM_TAIL_WINDOW_M that must be steep (≥ TRIM_MIN_GRADE_PCT) for
 *  the candidate endpoint to be accepted. Lower values tolerate noisy climbs; higher
 *  values enforce a cleaner end. */
export const TRIM_STEEP_RATIO = 0.2;
/** Minimum elevation gain (m) that must exist in the suffix after an endIndex candidate for
 *  the endpoint to be accepted. Prevents a single noise spike in an otherwise flat tail from
 *  anchoring the climb end too far along the route. */
export const TRIM_TAIL_MIN_ELEV_M = 15;
/** Minimum remaining distance (m) after trimming; shorter climbs are discarded. */
export const TRIM_MIN_DISTANCE_M = 100;
