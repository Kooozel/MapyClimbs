/**
 * max-gradient.ts — The one definition of "maximum gradient over a window".
 *
 * Both product figures that call themselves a max gradient come from here, and
 * differ only in what they are handed and how wide the window is:
 *
 *   - max *sustained* gradient — dense smoothed segments, 200 m window. What a
 *     rider feels for a couple of hundred metres. Feeds the hiking score and the
 *     CLI's `max_grade` column. See computeMaxSustainedGradient (climb-engine.ts).
 *   - max *pitch* gradient — the simplified chart profile, 25 m floor. The
 *     steepest colour band actually drawn on the card. See maxPitchGradient
 *     (gradient-zones.ts).
 *
 * They were once two implementations with two different algorithms, which drifted
 * until the card and the CLI reported different numbers for the same climb. Keep
 * both rationales here, together, so they cannot drift apart again.
 *
 * Its own module rather than a home in either caller: climb-engine.ts must not
 * depend on gradient-zones.ts (chart/overlay colour logic, which would then have
 * to travel with the engine), and gradient-zones.ts must not depend on the engine
 * (the content-script bundle would reach the whole pipeline for one loop).
 *
 * No DOM or browser-API dependencies — pure data transformation.
 */

/** Minimum shape the window scan needs. `ProfilePoint` satisfies it structurally. */
export interface GradientPoint {
  distance: number;
  elevation: number;
}

/**
 * Steepest geometric rise/run (%) over the shortest span of at least `windowM`
 * metres starting at any point. Wider spans from the same start only average
 * down, so the first span that satisfies `windowM` is the best one from there.
 *
 * When the whole profile is shorter than `windowM` there is no such span, and
 * the answer is the profile's own overall gradient: the widest span it has, so
 * the same conservative read the window asks for, just over less distance —
 * deliberately not the steepest sub-span, which would be a narrower window than
 * the caller asked for. Returning 0 here (what both callers did before they were
 * unified) reported a real 8 % climb as flat: it reached the CLI's `max_grade`
 * column and zeroed the hiking score's G_max term (#69).
 *
 * Both paths floor at 0: a net-descending span is not a max gradient, and the
 * window scan has always reported 0 for one.
 */
export function maxGradientOverWindow(points: GradientPoint[], windowM: number): number {
  if (points.length < 2) return 0;

  // `distance` is cumulative, so this is exactly the case where the loop below
  // could find no qualifying span — and not the other way it can return 0, a
  // long but net-descending profile, which must keep returning 0.
  const first = points[0];
  const last = points[points.length - 1];
  const totalSpan = last.distance - first.distance;
  if (totalSpan < windowM) {
    if (totalSpan <= 0) return 0;
    return Math.max(0, ((last.elevation - first.elevation) / totalSpan) * 100);
  }

  let best = 0;
  for (let i = 0; i < points.length - 1; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dist = points[j].distance - points[i].distance;
      if (dist < windowM) continue;
      best = Math.max(best, ((points[j].elevation - points[i].elevation) / dist) * 100);
      break;
    }
  }
  return best;
}
