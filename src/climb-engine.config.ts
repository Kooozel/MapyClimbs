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
export const SMOOTH_GRAD_WINDOW_M = 500;

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
export const CLIMB_START_GRADE_PCT = 2;
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

// ── Climb merging (Step 4 cont. & Step 7) ────────────────────────────────────

/** Default maximum gap (m) between two climbs that can be merged (first pass). */
export const MERGE_MAX_GAP_M = 2000;
/** Maximum gap (m) used when re-merging after the anti-green split (Step 7). */
export const MERGE_RE_MAX_GAP_M = 1500;
/** Absolute maximum valley drop (m) allowed between two merged climbs. */
export const MERGE_MAX_VALLEY_DROP_M = 50;
/** Combined-gain fraction used to compute the relative valley-drop limit. */
export const MERGE_VALLEY_RATIO = 0.15;

// ── Endpoint trimming (Step 5) ────────────────────────────────────────────────

/** Gradient (%) below which leading/trailing segments are trimmed. */
export const TRIM_MIN_GRADE_PCT = 1.5;
/** Minimum remaining distance (m) after trimming; shorter climbs are discarded. */
export const TRIM_MIN_DISTANCE_M = 100;

// ── Anti-green splitting (Step 6) ─────────────────────────────────────────────

/** Gradient (%) below which a segment is considered flat for splitting purposes. */
export const SPLIT_FLAT_GRADE_PCT = 2;
/** Accumulated flat distance (m) that triggers a split. */
export const SPLIT_FLAT_LENGTH_M = 400;
