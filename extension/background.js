/**
 * Background Service Worker — Mapy.cz Climb Analyzer v0.4
 * Processes elevation data and detects climbs.
 */

// Track connected popup ports
let popupPorts = [];

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.push(port);
    port.onDisconnect.addListener(() => {
      popupPorts = popupPorts.filter(p => p !== port);
    });
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PROCESS_CLIMBS') {
    try {
      const climbs = detectClimbs(request.elevation);
      const totalDistance = request.elevation.length > 0
        ? request.elevation[request.elevation.length - 1][0] : 0;
      chrome.storage.local.set({ lastClimbResult: climbs, lastTotalDistance: totalDistance });
      sendResponse({ climbs, totalDistance });
    } catch (error) {
      console.error('[ClimbAnalyzer] Climb detection error:', error);
      sendResponse({ climbs: [], error: error.message });
    }
  } else if (request.type === 'GPX_CAPTURED') {
    chrome.storage.local.set({
      pendingGPX: request.gpxContent,
      gpxCaptureTime: request.timestamp
    }, () => {
      popupPorts.forEach(port => {
        try { port.postMessage({ type: 'GPX_CAPTURED', timestamp: request.timestamp }); }
        catch (_) {}
      });
    });
    sendResponse({ success: true });
  }
});

/**
 * Climb Detection Algorithm
 * Processes elevation profile to identify and categorize climbs.
 */
function detectClimbs(elevationData) {
  if (!elevationData || elevationData.length < 2) return [];

  const profile = elevationData.map(point => ({
    distance:  point[0],
    elevation: point[1],
    lat: point[2] ?? null,
    lon: point[3] ?? null
  }));

  const smoothed = smoothElevationProfile(profile);
  const segments = calculateGradients(smoothed);
  const rawClimbs = identifyClimbs(segments);
  const mergedClimbs = mergeNearbyClimbs(rawClimbs, segments);

  return mergedClimbs.map(climb => {
    const trimmed = trimClimbEndpoints(climb);
    if (trimmed.totalDistance > 0 && trimmed.totalElevation > 0) {
      return categorizeClimb(trimmed);
    }
    return null;
  }).filter(c => c !== null);
}

/**
 * Smooth elevation profile using a distance-based rolling average.
 * Reduces DEM/GPS noise while preserving the shape of real climbs.
 * @param {Array} profile  - [{distance, elevation}, ...]
 * @param {number} windowMeters - half-window radius in metres (default 150m)
 */
function smoothElevationProfile(profile, windowMeters = 150) {
  if (profile.length <= 2) return profile;
  return profile.map(point => {
    let sumElev = 0;
    let count = 0;
    for (const p of profile) {
      if (Math.abs(p.distance - point.distance) <= windowMeters) {
        sumElev += p.elevation;
        count++;
      }
    }
    // Preserve lat/lon from the original point — only elevation is smoothed
    return {
      distance: point.distance,
      elevation: count > 0 ? sumElev / count : point.elevation,
      lat: point.lat,
      lon: point.lon
    };
  });
}

/**
 * Trim near-flat sections (<1.5% gradient) from the start and end of a climb.
 * Sections in the middle are preserved regardless of gradient.
 */
function trimClimbEndpoints(climb) {
  const TRIM_THRESHOLD = 1.5; // trim sub-1.5% gradient from climb endpoints
  const MIN_REMAINING = 100;  // at least 100m must remain after trimming

  const trimmed = { ...climb, segments: [...climb.segments] };

  if (!trimmed.segments || trimmed.segments.length === 0) return trimmed;

  let startIndex = 0;
  while (startIndex < trimmed.segments.length && trimmed.segments[startIndex].gradient < TRIM_THRESHOLD) {
    startIndex++;
  }

  let endIndex = trimmed.segments.length - 1;
  while (endIndex >= 0 && trimmed.segments[endIndex].gradient < TRIM_THRESHOLD) {
    endIndex--;
  }

  if (startIndex > endIndex) {
    trimmed.segments = [];
    trimmed.totalDistance = 0;
    trimmed.totalElevation = 0;
    return trimmed;
  }

  const climbSegments = trimmed.segments.slice(startIndex, endIndex + 1);
  let newDistance = 0;
  let newElev = 0;
  for (const seg of climbSegments) {
    newDistance += seg.distance;
    newElev += seg.elevation;
  }

  if (newDistance >= MIN_REMAINING) {
    trimmed.segments = climbSegments;
    trimmed.totalDistance = newDistance;
    trimmed.totalElevation = newElev;
  } else {
    trimmed.segments = [];
    trimmed.totalDistance = 0;
    trimmed.totalElevation = 0;
  }

  return trimmed;
}

/**
 * Merge consecutive climbs that are separated by a short valley or
 * a brief descent/flat interruption within what should be a single climb.
 *
 * Two climbs are merged when BOTH conditions are met:
 *   1. Gap distance ≤ MAX_GAP_DISTANCE — they are physically within range
 *   2. Valley depth ≤ max(MAX_VALLEY_DROP_ABS, combined_gain × RELATIVE_VALLEY_RATIO)
 *      — the dip is small relative to the total elevation work being done
 *
 * Using a relative threshold handles real-world cases like:
 *   - 1.5 km @ -2.7% (40 m loss) between two big climbs (+550 m, +300 m):
 *     allowable drop = max(50, 850 × 0.15) = 127 m  → 40 m qualifies → merged ✓
 *   - 80 m drop between two 50 m climbs:
 *     allowable drop = max(50, 100 × 0.15) = 50 m  → 80 m fails → kept separate ✓
 *
 * The merge is applied in a single left-to-right pass, so a chain of
 * valley climbs (A→B→C) naturally collapses into one (ABC).
 *
 * @param {Array} climbs      - output of identifyClimbs (trailing descents stripped)
 * @param {Array} allSegments - full smoothed segment array from calculateGradients
 */
function mergeNearbyClimbs(climbs, allSegments) {
  if (climbs.length <= 1) return climbs;

  const MAX_GAP_DISTANCE      = 2000; // m  — hard upper bound on valley distance
  const MAX_VALLEY_DROP_ABS   = 50;   // m  — always merge if abs drop ≤ this
  const RELATIVE_VALLEY_RATIO = 0.15; // 15% of combined elevation gain is also acceptable

  const result = [climbs[0]];

  for (let i = 1; i < climbs.length; i++) {
    const prev = result[result.length - 1];
    const curr = climbs[i];

    const prevLastSeg  = prev.segments[prev.segments.length - 1];
    const currFirstSeg = curr.segments[0];

    // Distance of the gap between the two climbs
    const gapDistance = currFirstSeg.startDistance - prevLastSeg.endDistance;
    // Elevation lost in the valley (positive = down, negative = still climbing)
    const elevDrop = prevLastSeg.endElevation - currFirstSeg.startElevation;

    // Allowable drop scales with the combined elevation gain of both climbs
    const combinedGain = prev.totalElevation + curr.totalElevation;
    const maxAllowedDrop = Math.max(MAX_VALLEY_DROP_ABS, combinedGain * RELATIVE_VALLEY_RATIO);

    if (gapDistance >= 0 && gapDistance <= MAX_GAP_DISTANCE && elevDrop <= maxAllowedDrop) {
      const gapSegs = allSegments.filter(s =>
        s.startDistance >= prevLastSeg.endDistance - 0.1 &&
        s.startDistance <  currFirstSeg.startDistance
      );

      const mergedSegs = [...prev.segments, ...gapSegs, ...curr.segments];
      let totalDist = 0, totalElev = 0;
      for (const s of mergedSegs) {
        totalDist += s.distance;
        totalElev += s.elevation;
      }

      result[result.length - 1] = {
        segments: mergedSegs,
        totalDistance: totalDist,
        totalElevation: totalElev
      };
    } else {
      result.push(curr);
    }
  }

  return result;
}


function pushClimb(climb, climbs, minDist, minElev, minGrade) {
  const candidate = { ...climb, segments: [...climb.segments] };

  // Remove downhill tail so the climb stats reflect only the ascent
  while (candidate.segments.length > 0 &&
         candidate.segments[candidate.segments.length - 1].gradient < 0) {
    const removed = candidate.segments.pop();
    candidate.totalDistance -= removed.distance;
    candidate.totalElevation -= removed.elevation;
  }

  if (candidate.segments.length === 0 || candidate.totalDistance <= 0) return;

  const avgGrade = (candidate.totalElevation / candidate.totalDistance) * 100;

  if (candidate.totalDistance >= minDist &&
      candidate.totalElevation >= minElev &&
      avgGrade >= minGrade) {
    climbs.push(candidate);
  }
}

/**
 * Calculate gradient for each segment
 * gradient = (elevation_change / distance_change) * 100
 */
function calculateGradients(profile) {
  const segments = [];

  for (let i = 1; i < profile.length; i++) {
    const prev = profile[i - 1];
    const curr = profile[i];

    const distanceDelta = curr.distance - prev.distance;
    const elevationDelta = curr.elevation - prev.elevation;

    // Avoid division by zero
    const gradient = distanceDelta > 0 ? (elevationDelta / distanceDelta) * 100 : 0;

    segments.push({
      startDistance: prev.distance,
      endDistance: curr.distance,
      distance: distanceDelta,
      elevation: elevationDelta,
      gradient: gradient,
      startElevation: prev.elevation,
      endElevation: curr.elevation,
      startLat: prev.lat ?? null,
      startLon: prev.lon ?? null,
      endLat: curr.lat ?? null,
      endLon: curr.lon ?? null
    });
  }

  return segments;
}

/**
 * Identify climb regions using a sliding window.
 *
 * Key design decisions vs the old algorithm:
 * - Lower start grade (2% vs 3%) — catches gentler Czech/Slovak hills
 * - Shorter minimum length (300m vs 500m) — catches shorter but real climbs
 * - Shorter descent to end a climb (150m vs 300m) — separates individual hills
 * - Descent trigger at -1% instead of 0% — brief -0.5% rollers don't split a climb
 * - Always reset after sufficient descent (even if climb hadn't qualified yet) —
 *   prevents a pre-qualification descent from poisoning the next candidate
 * - Trailing descent is stripped before saving — fixes the core bug where
 *   300m of downhill dragged avg grade below the filter threshold
 */
function identifyClimbs(segments) {
  const CLIMB_START_GRADE  = 2;    // % — minimum gradient to open a climb
  const MIN_CLIMB_DISTANCE = 300;  // m — minimum length to qualify
  const MIN_CLIMB_ELEV     = 10;   // m — minimum net elevation gain
  const DESCENT_GRADE      = -1;   // % — gradient considered a real descent
  const DESCENT_DISTANCE   = 150;  // m — cumulative descent that closes a climb
  const MIN_AVG_GRADE      = 2;    // % — minimum average grade to be a real climb

  const climbs = [];
  let currentClimb = null;
  let descentDistance = 0;

  for (const segment of segments) {
    // Track cumulative descent
    if (segment.gradient <= DESCENT_GRADE) {
      descentDistance += segment.distance;
    } else {
      descentDistance = 0;
    }

    if (segment.gradient >= CLIMB_START_GRADE && currentClimb === null) {
      // Begin a new climb candidate
      currentClimb = {
        segments: [segment],
        totalDistance: segment.distance,
        totalElevation: segment.elevation
      };
      descentDistance = 0;

    } else if (currentClimb !== null) {
      currentClimb.segments.push(segment);
      currentClimb.totalDistance += segment.distance;
      currentClimb.totalElevation += segment.elevation;

      // End the climb when enough cumulative descent has been seen
      if (descentDistance >= DESCENT_DISTANCE) {
        if (currentClimb.totalDistance >= MIN_CLIMB_DISTANCE) {
          pushClimb(currentClimb, climbs, MIN_CLIMB_DISTANCE, MIN_CLIMB_ELEV, MIN_AVG_GRADE);
        }
        // Always reset so descents never contaminate the next candidate
        currentClimb = null;
        descentDistance = 0;
      }
    }
  }

  // Save a climb that ends at the route finish (no trailing descent)
  if (currentClimb && currentClimb.totalDistance >= MIN_CLIMB_DISTANCE) {
    pushClimb(currentClimb, climbs, MIN_CLIMB_DISTANCE, MIN_CLIMB_ELEV, MIN_AVG_GRADE);
  }

  return climbs;
}

/**
 * Categorize a climb using ProCyclingStats formula
 * Score = distance(km) × avgGrade(%) × 100
 * Softer thresholds to properly reflect climb difficulty
 * Cat 4: < 3,000
 * Cat 3: 3,000 - 8,000
 * Cat 2: 8,000 - 16,000
 * Cat 1: 16,000 - 40,000
 * HC: > 40,000
 */
function categorizeClimb(climb) {
  // Safety check
  if (!climb || climb.totalDistance === 0 || climb.totalElevation === 0) {
    return null;
  }
  
  const distanceKm = climb.totalDistance / 1000;
  const avgGrade = (climb.totalElevation / climb.totalDistance) * 100;
  
  // Use proper formula: distance(km) × grade(%) × 100
  // This matches ProCyclingStats and other professional climb databases
  const difficulty = distanceKm * avgGrade * 100;

  let category = '4';
  if (difficulty >= 40000) {
    category = 'HC';
  } else if (difficulty >= 16000) {
    category = '1';
  } else if (difficulty >= 8000) {
    category = '2';
  } else if (difficulty >= 3000) {
    category = '3';
  }

  console.log(`[ClimbAnalyzer] Categorizing: ${distanceKm.toFixed(2)} km, ${avgGrade.toFixed(1)}%, score ${difficulty.toFixed(0)} → Cat ${category}`);

  const firstSeg = climb.segments[0];
  const lastSeg  = climb.segments[climb.segments.length - 1];
  return {
    distance: climb.totalDistance,
    elevation: climb.totalElevation,
    avgGrade: avgGrade,
    difficulty: difficulty,
    category: category,
    segments: climb.segments,
    markerCoords: (firstSeg?.startLat != null)
      ? { lat: firstSeg.startLat, lon: firstSeg.startLon }
      : null,
    endCoords: (lastSeg?.endLat != null)
      ? { lat: lastSeg.endLat, lon: lastSeg.endLon }
      : null
  };
}
