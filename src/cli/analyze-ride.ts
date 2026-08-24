/**
 * analyze-ride.ts — Garmin ride GPX in, enriched climb analysis out.
 *
 * This is the contract ~/sport consumes: every climbs[] key maps 1:1 onto a
 * column of the `climbs` table, so sync.py --insert-climbs is a direct field
 * map. Keys are snake_case for that reason; the engine's own camelCase shapes
 * are converted here and nowhere else, leaving the engine untouched.
 */

import { detectClimbs, computeMaxSustainedGradient } from "../climb-engine";
import type { Climb, ScoringModel } from "../types";
import { parseGarminGpx } from "./garmin-gpx";
import type { RidePoint } from "./garmin-gpx";
import { aggregateWindow, indexAtDistance } from "./ride-metrics";
import type { HrZones, MovingOptions, WindowMetrics } from "./ride-metrics";

export interface AnalyzeOptions {
  /** Label echoed into the output, normally the input filename. */
  source: string;
  model: ScoringModel;
  /** Null when the caller passed no --zones; pct_z4z5 is then null throughout. */
  zones: HrZones | null;
  moving: MovingOptions;
}

export interface ClimbRow {
  climb_index: number;
  start_km: number;
  distance_m: number;
  elevation_m: number;
  avg_grade: number;
  max_grade: number;
  category: string;
  difficulty: number;
  moving_sec: number;
  elapsed_sec: number;
  vam: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  pct_z4z5: number | null;
  start_lat: number | null;
  start_lon: number | null;
  top_lat: number | null;
  top_lon: number | null;
}

export interface RouteTotals {
  start_time: string | null;
  total_distance_m: number;
  total_elevation_gain_m: number;
  total_elevation_loss_m: number;
  elapsed_sec: number;
  moving_sec: number;
  avg_hr: number | null;
  max_hr: number | null;
  z4z5_sec: number | null;
  /** Of z4z5_sec, how much fell inside a detected climb. The attribution
   *  number the whole integration rests on. */
  z4z5_sec_on_climb: number | null;
  climb_count: number;
  climb_moving_sec: number;
}

export interface RideAnalysis {
  source: string;
  scoring_model: ScoringModel;
  route: RouteTotals;
  climbs: ClimbRow[];
}

export function analyzeRide(gpxContent: string, options: AnalyzeOptions): RideAnalysis {
  const { points, tuples } = parseGarminGpx(gpxContent);
  const detected = detectClimbs(tuples, options.model);

  let z4z5OnClimb = 0;
  let climbMovingSec = 0;
  let sawClimbZoneData = false;
  const climbs: ClimbRow[] = [];

  detected.climbs.forEach((climb, index) => {
    const window = windowFor(climb, points, options);
    climbs.push(toClimbRow(climb, index, window));
    climbMovingSec += window.movingSec;
    if (window.z4z5Sec !== null) {
      z4z5OnClimb += window.z4z5Sec;
      sawClimbZoneData = true;
    }
  });

  const ride = aggregateWindow(points, 0, points.length - 1, options.zones, options.moving);
  const startTime = points[0]?.t;

  return {
    source: options.source,
    scoring_model: options.model,
    route: {
      start_time: startTime != null ? new Date(startTime * 1000).toISOString() : null,
      total_distance_m: round(detected.totalDistance, 1),
      total_elevation_gain_m: round(detected.totalElevationGain, 1),
      total_elevation_loss_m: round(detected.totalElevationLoss, 1),
      elapsed_sec: Math.round(ride.elapsedSec),
      moving_sec: Math.round(ride.movingSec),
      avg_hr: ride.avgHr === null ? null : Math.round(ride.avgHr),
      max_hr: ride.maxHr,
      z4z5_sec: ride.z4z5Sec === null ? null : Math.round(ride.z4z5Sec),
      z4z5_sec_on_climb: sawClimbZoneData ? Math.round(z4z5OnClimb) : null,
      climb_count: climbs.length,
      climb_moving_sec: Math.round(climbMovingSec),
    },
    climbs,
  };
}

function windowFor(climb: Climb, points: RidePoint[], options: AnalyzeOptions) {
  const startDistance = climb.segments[0].startDistance;
  const endDistance = climb.segments[climb.segments.length - 1].endDistance;
  const from = indexAtDistance(points, startDistance);
  const to = indexAtDistance(points, endDistance);
  return aggregateWindow(points, from, to, options.zones, options.moving);
}

function toClimbRow(climb: Climb, index: number, window: WindowMetrics): ClimbRow {
  const startDistance = climb.segments[0].startDistance;

  // VAM is only meaningful on moving time, and only when there is any.
  const vam = window.movingSec > 0 ? (climb.elevation / window.movingSec) * 3600 : null;
  const pctZ4Z5 =
    window.z4z5Sec !== null && window.movingSec > 0 ? window.z4z5Sec / window.movingSec : null;

  return {
    climb_index: index,
    start_km: round(startDistance / 1000, 3),
    distance_m: round(climb.distance, 1),
    elevation_m: round(climb.elevation, 1),
    avg_grade: round(climb.avgGrade, 2),
    // computeMaxSustainedGradient returns a decimal fraction over a 200 m window.
    max_grade: round(computeMaxSustainedGradient(climb.segments) * 100, 2),
    category: climb.category,
    difficulty: round(climb.difficulty, 1),
    moving_sec: Math.round(window.movingSec),
    elapsed_sec: Math.round(window.elapsedSec),
    vam: vam === null ? null : round(vam, 1),
    avg_hr: window.avgHr === null ? null : Math.round(window.avgHr),
    max_hr: window.maxHr,
    pct_z4z5: pctZ4Z5 === null ? null : round(pctZ4Z5, 4),
    start_lat: round(climb.markerCoords?.lat ?? null, 6),
    start_lon: round(climb.markerCoords?.lon ?? null, 6),
    top_lat: round(climb.endCoords?.lat ?? null, 6),
    top_lon: round(climb.endCoords?.lon ?? null, 6),
  };
}

function round(value: number, digits: number): number;
function round(value: number | null, digits: number): number | null;
function round(value: number | null, digits: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
