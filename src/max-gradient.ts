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
 * Returns 0 when no span reaches `windowM` — i.e. when the whole profile is
 * shorter than the window. That is wrong for a short climb, but it is what both
 * callers did before they were unified, and it is preserved deliberately so this
 * refactor moves no number; fixing it is tracked in #69.
 */
export function maxGradientOverWindow(points: GradientPoint[], windowM: number): number {
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
