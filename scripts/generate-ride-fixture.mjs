/**
 * generate-ride-fixture.mjs — regenerates test/fixtures/ride-synthetic.gpx.
 *
 * The ride fixtures the climb engine was tuned on are Mapy.cz route exports.
 * Ride data has a different shape: 1 Hz-ish barometric noise, stops, recording
 * gaps and heart rate. This builds a fixture with that shape and no personal
 * data — a straight line due north from a neutral point, with a scripted
 * elevation profile — so the CLI can be tested without committing a real ride.
 *
 * Run from the repo root:  node scripts/generate-ride-fixture.mjs
 */

import { writeFileSync } from "node:fs";

const DEG_PER_M = 1 / ((6371000 * Math.PI) / 180); // metres -> degrees of latitude
const START = { lat: 48.0, lon: 16.0, ele: 200, t: Date.parse("2026-03-14T09:00:00.000Z") / 1000 };
const STEP = 5; // seconds between samples

const pts = [];
let lat = START.lat,
  ele = START.ele,
  t = START.t,
  travelled = 0;

/** Ride a leg: distance in m, grade in %, speed in m/s, hr as f(progress 0..1). */
function leg(distanceM, gradePct, speedMps, hr) {
  const steps = Math.round(distanceM / (speedMps * STEP));
  for (let i = 0; i < steps; i++) {
    const dd = distanceM / steps;
    travelled += dd;
    lat += dd * DEG_PER_M;
    ele += (dd * gradePct) / 100;
    t += STEP;
    // Deterministic sub-metre barometric wobble, as a real barometer produces.
    const wobble = 0.18 * Math.sin(travelled / 37) + 0.12 * Math.sin(travelled / 11);
    pts.push({ lat, ele: ele + wobble, t, hr: Math.round(hr(i / steps)) });
  }
}

/** Stand still: time passes, position does not. */
function stop(seconds, hr) {
  for (let i = 0; i < seconds / STEP; i++) {
    t += STEP;
    pts.push({ lat, ele, t, hr: Math.round(hr(i / (seconds / STEP))) });
  }
}

const ramp = (from, to) => (p) => from + (to - from) * p;

leg(1000, 0, 6.9, ramp(102, 128)); // flat warm-up
leg(1200, 6, 3.3, ramp(140, 168)); // climb 1, lower half
stop(180, ramp(168, 96)); // 3-min stop mid-climb
leg(1300, 6, 3.3, ramp(150, 172)); // climb 1, upper half
leg(1400, -5, 11.1, ramp(150, 124)); // descent
t += 60; // 60 s recording gap
leg(1600, -5, 11.1, ramp(124, 118)); // descent resumes
leg(500, 0, 6.9, ramp(118, 132)); // flat
leg(1500, 5, 4.2, ramp(140, 166)); // climb 2
leg(500, 0, 6.9, ramp(150, 126)); // flat finish

const body = pts
  .map(
    (p) => `      <trkpt lat="${p.lat.toFixed(9)}" lon="${START.lon.toFixed(9)}">
        <ele>${p.ele.toFixed(2)}</ele>
        <time>${new Date(p.t * 1000).toISOString()}</time>
        <extensions>
          <ns3:TrackPointExtension>
            <ns3:hr>${p.hr}</ns3:hr>
          </ns3:TrackPointExtension>
        </extensions>
      </trkpt>`
  )
  .join("\n");

writeFileSync(
  "test/fixtures/ride-synthetic.gpx",
  `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="Garmin Connect" version="1.1"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/11.xsd"
  xmlns:ns3="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns2="http://www.garmin.com/xmlschemas/GpxExtensions/v3">
  <metadata>
    <time>${new Date(START.t * 1000).toISOString()}</time>
    <desc>Synthetic Garmin-shaped ride fixture. No personal data: the track is a
      straight line due north from 48.0N 16.0E with a scripted elevation profile.
      Profile, in order: 1000 m flat warm-up; 1200 m at 6%; a 3-minute stationary
      stop (moving time must exclude it); 1300 m at 6%; 1400 m descent at -5%; a
      60-second recording gap; 1600 m descent at -5%; 500 m flat; 1500 m at 5%;
      500 m flat finish. Sampled every 5 s with sub-metre barometric wobble.
      Heart rate ramps with effort and falls during the stop. Two climbs are
      expected. Regenerate with scripts/generate-ride-fixture.mjs.</desc>
  </metadata>
  <trk>
    <name>Synthetic Ride</name>
    <type>cycling</type>
    <trkseg>
${body}
    </trkseg>
  </trk>
</gpx>
`
);
console.log(`${pts.length} points, ${(travelled / 1000).toFixed(2)} km`);
