/**
 * Background Service Worker — Mapy.cz Climb Analyzer v0.5
 * Processes elevation data and detects climbs with improved algorithm.
 */

// Track connected popup ports
let popupPorts = [];

// Storage versioning for v0.5 — clear old cache if storage schema changed
const STORAGE_VERSION = 1; // Increment this when cache format changes
chrome.storage.local.get('storageVersion', (result) => {
  if (result.storageVersion !== STORAGE_VERSION) {
    console.log('[ClimbAnalyzer] Storage version mismatch, clearing old cache');
    chrome.storage.local.clear(() => {
      chrome.storage.local.set({ storageVersion: STORAGE_VERSION });
    });
  }
});

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
 * v0.5.1: Adds point resampling, smart trimming, and anti-green splitting
 */
function detectClimbs(elevationData) {
  if (!elevationData || elevationData.length < 2) return [];

  const profile = elevationData.map(point => ({
    distance:  point[0],
    elevation: point[1],
    lat: point[2] ?? null,
    lon: point[3] ?? null
  }));

  // v0.5.1: Point resampling to eliminate micro-jitter (< 10-15m points)
  const resampled = resamplePoints(profile);

  const smoothed = smoothElevationProfile(resampled);
  const segments = calculateGradients(smoothed);
  const rawClimbs = identifyClimbs(segments);
  const mergedClimbs = mergeNearbyClimbs(rawClimbs, segments);

  // v0.5.1: Post-merge processing for better visual presentation
  let processedClimbs = mergedClimbs.map(climb => {
    const trimmed = trimClimbEndpoints(climb);
    if (trimmed.totalDistance > 0 && trimmed.totalElevation > 0) {
      return categorizeClimb(trimmed);
    }
    return null;
  }).filter(c => c !== null);

  // v0.5.1: Anti-green splitting - split climbs with large flat sections
  processedClimbs = processedClimbs.map(climb => splitAntiGreenClimbs(climb))
                                   .flat()
                                   .filter(c => c !== null);

  return processedClimbs;
}

/**
 * v0.5.1: Point Resampling
 * Merge GPS points that are closer than RESAMPLE_THRESHOLD to eliminate
 * both jitter and unnecessary intermediate points in flat/low-gradient areas.
 * 
 * @param {Array} profile - [{distance, elevation, lat, lon}, ...]
 * @returns {Array} - resampled profile with jitter eliminated
 */
function resamplePoints(profile) {
  if (profile.length <= 2) return profile;

  const RESAMPLE_THRESHOLD = 12; // meters - points closer than this are merged
  let resampled = [profile[0]];

  for (let i = 1; i < profile.length; i++) {
    const prev = resampled[resampled.length - 1];
    const curr = profile[i];
    const distDelta = curr.distance - prev.distance;

    // If points are too close, skip this one (creates micro-points)
    if (distDelta < RESAMPLE_THRESHOLD) {
      continue;
    }

    resampled.push(curr);
  }

  // Ensure we always have the last point
  if (resampled[resampled.length - 1].distance !== profile[profile.length - 1].distance) {
    resampled.push(profile[profile.length - 1]);
  }

  return resampled;
}



/**
 * v0.5.1: Anti-Green Splitting
 * If a climb contains a section longer than 400m with grade <2%,
 * split it into separate climbs to avoid large "green voids" in UI.
 * Preserves all metadata for both resulting climbs.
 *
 * @param {Object} climb - climb to potentially split
 * @returns {Array} - array with 1 (no split) or 2+ climbs (split climbs)
 */
function splitAntiGreenClimbs(climb) {
  if (!climb || !climb.segments || climb.segments.length < 2) {
    return [climb];
  }

  const FLAT_THRESHOLD = 2; // % gradient
  const FLAT_LENGTH_THRESHOLD = 400; // meters
  const MINIMUM_CLIMB_DISTANCE = 300; // m - discard splits smaller than this

  const splits = [];
  let currentClimb = null;
  let flatDistance = 0;

  for (let i = 0; i < climb.segments.length; i++) {
    const seg = climb.segments[i];

    if (seg.gradient < FLAT_THRESHOLD) {
      // Accumulate flat/low-grade distance
      flatDistance += seg.distance;

      if (currentClimb) {
        currentClimb.segments.push(seg);
        currentClimb.distance += seg.distance;
        currentClimb.elevation += seg.elevation;
      }

      // If we've accumulated enough flat section, finalize current climb and reset
      if (flatDistance >= FLAT_LENGTH_THRESHOLD && currentClimb) {
        if (currentClimb.distance >= MINIMUM_CLIMB_DISTANCE) {
          // Recalculate climb stats before saving
          currentClimb.avgGrade = (currentClimb.elevation / currentClimb.distance) * 100;
          splits.push(currentClimb);
        }
        currentClimb = null;
        flatDistance = 0;
      }
    } else {
      // Reset flat counter when we hit steep terrain again
      flatDistance = 0;

      if (!currentClimb) {
        currentClimb = {
          distance: 0,
          elevation: 0,
          segments: [],
          avgGrade: climb.avgGrade,
          difficulty: climb.difficulty,
          category: climb.category,
          markerCoords: climb.markerCoords,
          endCoords: climb.endCoords
        };
      }

      currentClimb.segments.push(seg);
      currentClimb.distance += seg.distance;
      currentClimb.elevation += seg.elevation;
    }
  }

  // Finalize last climb if any
  if (currentClimb && currentClimb.distance >= MINIMUM_CLIMB_DISTANCE) {
    currentClimb.avgGrade = (currentClimb.elevation / currentClimb.distance) * 100;
    splits.push(currentClimb);
  }

  // If no valid splits, return original climb
  if (splits.length === 0) {
    return [climb];
  }

  return splits;
}

/**
 * Smooth elevation profile using adaptive gradient-magnitude-weighted window.
 * On steep terrain (>8%), uses narrow window (50m) to preserve sharp ramps.
 * On flat terrain (<3%), uses wide window (250m) to filter noise.
 * On rolling terrain (3-8%), scales smoothly between.
 * Prevents over-smoothing punchy climbs while reducing noise on flats.
 *
 * Algorithm:
 * 1. Calculate initial gradients over 500m windows to classify terrain type
 * 2. For each point, dynamically set window width based on local gradient
 * 3. Apply rolling average within that window
 * 4. Preserve lat/lon coordinate data
 *
 * @param {Array} profile - [{distance, elevation, lat, lon}, ...]
 */
function smoothElevationProfile(profile) {
  if (profile.length <= 2) return profile;

  // Step 1: Estimate local gradient at each point using 500m window
  const localGradients = profile.map((point, idx) => {
    let sumGradMag = 0;
    let count = 0;
    for (const p of profile) {
      const dist = Math.abs(p.distance - point.distance);
      if (dist <= 500) {
        // Distance-weighted gradient magnitude to prefer nearby terrain
        const weight = 1 - Math.abs(dist) / 500;
        const eleChange = Math.abs(p.elevation - point.elevation);
        const grad = eleChange > 0 ? eleChange / dist : 0;
        sumGradMag += Math.abs(grad) * weight;
        count++;
      }
    }
    return count > 0 ? sumGradMag / count : 0;
  });

  // Step 2: Smooth with adaptive window, then apply noise filtering
  const smoothed = profile.map((point, idx) => {
    const localGrad = localGradients[idx];
    
    // Dynamic window: steep terrain = narrow, flat = wide
    // Steep (>8%): 50m, Medium (3-8%): 100-150m, Flat (<3%): 250m
    let windowMeters;
    if (localGrad > 0.08) {
      windowMeters = 50;
    } else if (localGrad > 0.03) {
      windowMeters = 50 + ((0.08 - localGrad) / 0.05) * 100; // scale 50-150
    } else {
      windowMeters = 150 + ((0.03 - localGrad) / 0.03) * 100; // scale 150-250
    }
    windowMeters = Math.max(50, Math.min(250, windowMeters));

    // Collect points within adaptive window
    let sumElev = 0;
    let count = 0;
    for (const p of profile) {
      if (Math.abs(p.distance - point.distance) <= windowMeters) {
        sumElev += p.elevation;
        count++;
      }
    }

    return {
      distance: point.distance,
      elevation: count > 0 ? sumElev / count : point.elevation,
      lat: point.lat,
      lon: point.lon
    };
  });

  // Step 3: Apply noise filtering to remove unrealistic spikes (>12% over single segment)
  let result = filterNoiseSpikes(smoothed);

  // Step 4 (v0.5.1, optional): Apply Savitzky-Golay for even cleaner curves
  // Uncomment to enable more aggressive smoothing for cleaner but flatter profiles:
  // result = savitzkyGolaySmooth(result);

  return result;
}

/**
 * Filter out unrealistic elevation spikes (>12% gradient anomalies).
 * A single segment with >12% gradient is checked against neighbors:
 * If neighbors are <8%, the spike is likely DEM noise and is interpolated.
 *
 * @param {Array} profile - smoothed elevation profile
 * @returns {Array} - profile with noise spikes smoothed out
 */
function filterNoiseSpikes(profile) {
  if (profile.length <= 2) return profile;

  const result = profile.map(p => ({ ...p }));
  const SPIKE_THRESHOLD = 0.12; // >12% is suspicious
  const NEIGHBOR_THRESHOLD = 0.08; // neighbors should be <8%

  for (let i = 1; i < result.length - 1; i++) {
    const prev = result[i - 1];
    const curr = result[i];
    const next = result[i + 1];

    const prevGrad = Math.abs((curr.elevation - prev.elevation) / (curr.distance - prev.distance));
    const nextGrad = Math.abs((next.elevation - curr.elevation) / (next.distance - curr.distance));

    // If this segment is a spike (>12%) but neighbors are gentle (<8%), smooth it
    if ((prevGrad > SPIKE_THRESHOLD || nextGrad > SPIKE_THRESHOLD) &&
        prevGrad < NEIGHBOR_THRESHOLD && nextGrad < NEIGHBOR_THRESHOLD) {
      // Interpolate elevation instead of taking raw value
      result[i].elevation = (prev.elevation + next.elevation) / 2;
    }
  }

  return result;
}

/**
 * v0.5.1: Savitzky-Golay Smoothing (Optional Enhancement)
 * Applies a sliding window polynomial filter to smooth elevation while
 * preserving the "character" of steep ramps better than simple rolling average.
 * More sophisticated than rolling average but still fast.
 *
 * Uses a simple 3-point polynomial filter: f(x) = (f(x-1) + 2*f(x) + f(x+1)) / 4
 * Applied multiple passes for stronger smoothing on flat sections.
 *
 * @param {Array} profile - elevation profile
 * @returns {Array} - smoothed profile
 */
function savitzkyGolaySmooth(profile) {
  if (profile.length <= 2) return profile;

  // Single pass of Savitzky-Golay (3-point)
  const pass1 = profile.map((point, idx) => {
    if (idx === 0 || idx === profile.length - 1) {
      return { ...point }; // Keep endpoints unchanged
    }

    const prev = profile[idx - 1];
    const curr = profile[idx];
    const next = profile[idx + 1];

    const smoothedElev = (prev.elevation + 2 * curr.elevation + next.elevation) / 4;

    return {
      ...curr,
      elevation: smoothedElev
    };
  });

  return pass1;
}

/**
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
  const MIN_CLIMB_ELEV     = 30;   // m — minimum net elevation gain (v0.5 gate)
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
