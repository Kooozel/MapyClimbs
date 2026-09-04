/**
 * climb-engine.config.ts — MapyClimbs
 *
 * All numeric thresholds and tuning constants for the climb-detection pipeline,
 * as one object. `DEFAULT_CLIMB_CONFIG` is what detectClimbs() runs with when a
 * caller passes nothing; a consumer overrides any subset through
 * `DetectClimbsOptions.config` (climb-types.ts), which is shallow-merged over
 * these. Adjust values here to change the built-in behaviour without touching
 * the logic.
 */

// The two values other defaults are computed from, kept as locals so the
// derivation stays visible in the file. They are NOT re-derived at merge time —
// see the note on SPIKE_MAX_SEGMENT_M.
const RESAMPLE_MIN_INTERVAL_M = 12;
const CLIMB_LEADIN_GRADE_PCT = 2.5;

export const DEFAULT_CLIMB_CONFIG = {
  // ── Resampling (Step 2) ─────────────────────────────────────────────────────

  /** Minimum distance (m) between two consecutive profile points after resampling. */
  RESAMPLE_MIN_INTERVAL_M,

  // ── Profile interpolation (between Step 2 and Step 3) ──────────────────────

  /** Minimum gap (m) that interpolateProfile() will fill with intermediate points.
   *  Pre-smoothing interpolation makes the rolling-average window behave uniformly
   *  across dense and sparse sections, at the cost of shifting climb boundaries
   *  slightly — the trade this value tunes. Applied in Step 2b of detectClimbs(). */
  INTERPOLATE_MAX_GAP_M: 25,

  // ── Smoothing — gradient estimation window (Step 3, Pass 1) ────────────────

  /** Half-width (m) of the window used to estimate local gradient magnitude. */
  SMOOTH_GRAD_WINDOW_M: 200,

  // ── Smoothing — adaptive rolling-average window (Step 3, Pass 2) ───────────

  /** Grade (fraction) above which the narrowest smoothing window is applied. */
  SMOOTH_STEEP_GRADE_THRESHOLD: 0.08,
  /** Grade (fraction) below which interpolation shifts toward the widest window. */
  SMOOTH_MID_GRADE_THRESHOLD: 0.03,
  /** Narrowest rolling-average window in metres (used on steep segments). */
  SMOOTH_WINDOW_MIN_M: 50,
  /** Rolling-average window (m) at the mid-grade boundary. */
  SMOOTH_WINDOW_MID_M: 150,
  /** Widest rolling-average window in metres (used on flat segments). */
  SMOOTH_WINDOW_MAX_M: 250,

  // ── Noise spike filter (Step 3, Pass 3) ────────────────────────────────────

  /** Gradient (fraction) that flags a point as a potential spike. */
  SPIKE_GRADIENT_THRESHOLD: 0.12,
  /** Gradient (fraction) the neighbouring segment must be below to confirm a spike. */
  SPIKE_NEIGHBOR_THRESHOLD: 0.08,
  /** Maximum segment length (m) for a point to be considered a spike candidate.
   *  Segments longer than this represent real terrain, not GPS jitter.
   *
   *  Its default is RESAMPLE_MIN_INTERVAL_M × 2, but the merged config is flat:
   *  overriding RESAMPLE_MIN_INTERVAL_M does not move this key. Set both. */
  SPIKE_MAX_SEGMENT_M: RESAMPLE_MIN_INTERVAL_M * 2,

  // ── Climb identification (Step 4) ───────────────────────────────────────────

  /** Gradient (%) at or above which a new climb candidate begins. */
  CLIMB_START_GRADE_PCT: 3.75,
  /** Lead-in extension threshold: gradient (%) above which a segment that
   *  *precedes* a climb-opening trigger is treated as part of the climb's
   *  natural approach. When a new candidate opens, the most recent run of
   *  segments at or above this grade (capped at CLIMB_LEADIN_MAX_DISTANCE_M)
   *  is prepended to the candidate. Stops at the first descent / flat segment. */
  CLIMB_LEADIN_GRADE_PCT,
  /** Maximum lead-in distance (m) absorbed by the start-extension step. */
  CLIMB_LEADIN_MAX_DISTANCE_M: 500,

  /** Gradient (%) above which an already-open candidate stays alive.
   *  This is the *continue* threshold; it resets the flat-distance close-counter
   *  but does NOT open a new candidate on its own. Setting it below
   *  CLIMB_START_GRADE_PCT introduces hysteresis: a steady 3.5 % climb with
   *  brief 4 % bursts starts on a burst and survives the 3.5 % stretches
   *  instead of being closed by the 700 m flat rule.
   *
   *  Empirical note: the current fixture set tolerates values in [3.5, 3.75]
   *  without regressions. Lower values (2.5–3.0) over-merge hukvaldy's chain of
   *  back-to-back sub-km bumps connected by 2.5–3.5 % slopes. A topology-aware
   *  trigger (net-gain-over-window) would let CONTINUE drop further safely;
   *  that's Phase 2 work. */
  CLIMB_CONTINUE_GRADE_PCT: 3.5,
  /** Gradient (%) at or below which a segment counts as a descent. */
  DESCENT_END_GRADE_PCT: -1,
  /** Accumulated descent distance (m) that ends the current climb candidate. */
  DESCENT_END_DISTANCE_M: 150,
  /** Accumulated flat/low-grade distance (m, grade < CLIMB_START_GRADE_PCT) that ends the current
   *  climb candidate. Prevents a brief 2%+ ramp at the start of a long flat section from absorbing
   *  every subsequent climb into one low-average-grade candidate. Keeping this small enough means
   *  distinct climbs separated by ~1 km of flat terrain are still identified as separate candidates,
   *  while the gain-scaled merge step can later re-join climbs that deserve it. */
  CLIMB_END_FLAT_M: 700,

  // ── Climb merging (Step 4 cont.) ───────────────────────────────────────────
  //
  // Gap distance uses a two-part formula:
  //   effectiveMaxGap = adjustedBase + min(smallerGain × MERGE_GAP_GAIN_SCALE, MERGE_GAP_MAX_BONUS_M)
  //
  // CLIMB_END_FLAT_M (above) creates a real distance gap between raw climb candidates
  // when a long flat section ends a climb. MERGE_GAP_GAIN_SCALE then decides whether
  // that gap is small enough relative to the smaller climb's elevation gain to merge.

  /** Base maximum gap (m) between two climbs that can be merged. Gain-scaling extends this. */
  MERGE_MAX_GAP_M: 1200,
  /** Metres of extra merge-gap allowance per metre of the smaller climb's elevation gain. */
  MERGE_GAP_GAIN_SCALE: 5.5,
  /** Cap on the gain-based bonus (m), keeping total effective gap from growing unbounded. */
  MERGE_GAP_MAX_BONUS_M: 4000,
  /** Tighter base gap (m) used when the terrain in the gap *descends* in the raw profile.
   *  Prevents merging two climbs across a genuine valley when the gap distance would
   *  otherwise be within MERGE_MAX_GAP_M. Ascending/flat gaps keep the full base.
   *  The effective cap is max(MERGE_DESCENT_GAP_MAX_M, smallerGain × MERGE_DESCENT_SCALE)
   *  so large high-gain climbs can still bridge longer descent gaps (e.g. a levelling
   *  section mid-mountain). */
  MERGE_DESCENT_GAP_MAX_M: 760,
  MERGE_DESCENT_SCALE: 4,
  /** Absolute maximum valley drop (m) allowed between two merged climbs. */
  MERGE_MAX_VALLEY_DROP_M: 20,
  /** Combined-gain fraction used to compute the relative valley-drop limit. */
  MERGE_VALLEY_RATIO: 0.2,
  /** Reference ratio used only by the debug-stage `coherentAscent` signal in
   *  mergeNearbyClimbs(). Not currently wired into the merge decision — a
   *  naive force-merge based on this ratio over-merged adjacent-but-distinct
   *  climbs on rolling routes (bk / grun / hukvaldy) where two ascents share a
   *  high start-to-end raw rise. Kept here so future tuning / Phase 2 work can
   *  reuse the constant rather than rediscovering it. */
  MERGE_COHERENT_ASCENT_RATIO: 0.85,

  // ── Endpoint trimming (Step 5) ──────────────────────────────────────────────

  /** Lead-in trim threshold: gradient (%) below which *leading* segments are
   *  stripped. Set to CLIMB_LEADIN_GRADE_PCT so the explicit lead-in extension
   *  (prepended at identify time) survives trim. Stricter than this and the
   *  extension is undone immediately.
   *
   *  Like SPIKE_MAX_SEGMENT_M, the derivation is a default only: the merged
   *  config is flat, so overriding CLIMB_LEADIN_GRADE_PCT does not move this
   *  key. Set both. */
  TRIM_START_GRADE_PCT: CLIMB_LEADIN_GRADE_PCT,
  /** Tail trim threshold: gradient (%) below which *trailing* segments are
   *  stripped. Lower than CLIMB_START_GRADE_PCT so the climb extends through
   *  the natural sub-trigger run-out toward the summit without making detection
   *  more permissive in opening new candidates. */
  TRIM_END_GRADE_PCT: 2.5,
  /** Backward look-behind window (m) used to judge whether a candidate end-segment lies in a
   *  genuinely steep zone. At each candidate endIndex the algorithm sums the steep and total
   *  distance of the last TRIM_TAIL_WINDOW_M metres. If the steep fraction is below
   *  TRIM_STEEP_RATIO the segment is treated as an isolated noise spike and discarded. */
  TRIM_TAIL_WINDOW_M: 200,
  /** Minimum fraction of TRIM_TAIL_WINDOW_M that must be steep (≥ TRIM_END_GRADE_PCT) for
   *  the candidate endpoint to be accepted. Lower values tolerate noisy climbs; higher
   *  values enforce a cleaner end. */
  TRIM_STEEP_RATIO: 0.2,

  // ── Max sustained gradient (reporting / hiking score) ──────────────────────

  /** Window (m) over which the max *sustained* gradient is measured. Wide enough
   *  that a single steep pitch cannot dominate it — reporting that pitch is
   *  maxPitchGradient's job (gradient-zones.ts). Feeds the hiking score's G_max
   *  term and the CLI's `max_grade` column.
   *
   *  Deliberately its own constant rather than a reuse of SMOOTH_GRAD_WINDOW_M,
   *  which happens to be 200 too: that one is a smoothing input, and tying them
   *  together would move a reported figure every time smoothing is retuned. */
  MAX_SUSTAINED_GRADIENT_WINDOW_M: 200,

  // ── Summit snap (Step 5b) ───────────────────────────────────────────────────

  /** Cap (m) on how far past a climb's trimmed end the summit snap will look for a
   *  higher raw-profile point. The effective lookahead is the smaller of this and
   *  half the gap to the next climb, so the snap can never reach into one. */
  SNAP_LOOKAHEAD_MAX_M: 300,
};

/** Derived from the defaults rather than declared beside them, so the type and the
 *  values cannot drift and every key keeps exactly one doc comment. Property types
 *  widen to `number` (no `as const`), which is what makes Partial<ClimbConfig>
 *  accept an arbitrary override. */
export type ClimbConfig = typeof DEFAULT_CLIMB_CONFIG;
