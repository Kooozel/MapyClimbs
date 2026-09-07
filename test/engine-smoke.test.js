/**
 * test/engine-smoke.test.js
 *
 * A pin on the *installed* `climb-engine` package, not a re-run of its own
 * integration suite — that suite lives in the library and runs on every one of
 * its PRs. What it cannot catch is a bad version bump landing *here*, which
 * would otherwise surface as a wrong panel in the browser rather than as a red
 * test. So one real route goes through the whole pipeline and the numbers are
 * pinned exactly, with no tolerances: the only thing allowed to move them is a
 * deliberate change to the pinned ref in package.json (#83).
 *
 * All three scoring models are covered because the model choice is made on this
 * side of the boundary (scoring-view.ts), hiking included.
 *
 * Run: npm test
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { parseGpx } from "climb-engine/gpx";
import { detectClimbs, score } from "climb-engine";

const __dirname = dirname(fileURLToPath(import.meta.url));

function detect(fixture) {
  const xml = readFileSync(resolve(__dirname, "fixtures", fixture), "utf8");
  return detectClimbs(parseGpx(xml).tuples);
}

function categoriesFor(result, model) {
  return score(result, model)
    .filter((climb) => climb.category !== null)
    .map((climb) => climb.category);
}

describe("installed climb-engine package", () => {
  const result = detect("travny.gpx");

  it("measures every candidate on the route, judging none of them", () => {
    expect(result.climbs.length).toBe(8);
    // The core measures and does not judge (#77) — category is the view's word.
    expect(result.climbs.every((climb) => !("category" in climb))).toBe(true);
  });

  it("keeps the models disagreeing about the same measurements", () => {
    expect(categoriesFor(result, "garmin")).toEqual([
      "1",
      "uncategorized",
      "uncategorized",
      "uncategorized",
      "uncategorized",
    ]);
    expect(categoriesFor(result, "aso")).toEqual(["2", "uncategorized", "uncategorized"]);
    expect(categoriesFor(result, "hiking")).toEqual(["4"]);
  });

  it("pins the geometry of the route’s one real climb", () => {
    const climb = score(result, "garmin").find((c) => c.category === "1");
    expect(Math.round(climb.distance)).toBe(8571);
    expect(Math.round(climb.elevation)).toBe(507);
    expect(Number(climb.avgGrade.toFixed(2))).toBe(5.91);
  });
});
