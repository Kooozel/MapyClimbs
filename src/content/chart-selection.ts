/**
 * content/chart-selection.ts — Drag-to-select a section of a climb's elevation
 * chart, and read back its distance and average gradient.
 *
 * Split in two halves:
 *   - pure range maths (`elevationAtDistance`, `summarizeRange`) — unit tested
 *   - DOM wiring (`attachChartSelection`) — attached per climb card
 *
 * Depends on: chart.ts (plot geometry, so pointer maths uses the very margins
 * the curve was drawn with).
 *
 * Exports: elevationAtDistance, summarizeRange, attachChartSelection
 */

import type { ProfilePoint } from "../gradient-zones";
import { CHART_PLOT, chartXToDistance, distanceToChartX } from "./chart";
import { metersToKm, toPercent } from "../format";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RangeSummary {
  /** Range start, in metres from the climb's start. */
  start: number;
  /** Range end, in metres from the climb's start. */
  end: number;
  /** Range length in metres. */
  distance: number;
  /** Net elevation change over the range (metres, signed). */
  elevationDelta: number;
  /** Net gradient over the range, in percent (signed). */
  avgGrade: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Minimum pointer travel (rendered px) before a press counts as a selection
 * drag. Below this it is a plain click on the card, which centres the map.
 */
const MIN_DRAG_PX = 4;

/**
 * The one selection currently shown, across every card. Selecting inside a
 * second chart clears the first, so the readout is never ambiguous.
 */
let clearActiveSelection: (() => void) | null = null;

// ── Range maths (pure) ────────────────────────────────────────────────────────

/**
 * Elevation at an arbitrary distance along the profile, linearly interpolated
 * between the two bracketing points. Distances outside the profile clamp to its
 * ends.
 */
export function elevationAtDistance(profile: ProfilePoint[], distance: number): number {
  if (profile.length === 0) return 0;
  if (distance <= profile[0].distance) return profile[0].elevation;

  const last = profile[profile.length - 1];
  if (distance >= last.distance) return last.elevation;

  for (let i = 1; i < profile.length; i++) {
    const b = profile[i];
    if (b.distance < distance) continue;
    const a = profile[i - 1];
    const span = b.distance - a.distance;
    if (span <= 0) return b.elevation;
    return a.elevation + ((distance - a.distance) / span) * (b.elevation - a.elevation);
  }
  return last.elevation;
}

/**
 * Distance, net elevation change and average gradient between two distances
 * along the profile. The bounds may arrive in either order — dragging right to
 * left is the same selection as dragging left to right.
 */
export function summarizeRange(profile: ProfilePoint[], from: number, to: number): RangeSummary {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const distance = end - start;
  const elevationDelta = elevationAtDistance(profile, end) - elevationAtDistance(profile, start);

  return {
    start,
    end,
    distance,
    elevationDelta,
    avgGrade: distance > 0 ? (elevationDelta / distance) * 100 : 0,
  };
}

// ── DOM wiring ────────────────────────────────────────────────────────────────

interface ChartParts {
  svg: SVGSVGElement;
  selGroup: SVGGElement;
  dimBefore: SVGRectElement;
  dimAfter: SVGRectElement;
  edgeBefore: SVGLineElement;
  edgeAfter: SVGLineElement;
  legend: HTMLElement;
  readout: HTMLElement;
}

/** Collects the selection-related nodes, or null when the card has no chart. */
function findChartParts(card: HTMLElement): ChartParts | null {
  const svg = card.querySelector<SVGSVGElement>(".profile-svg");
  const selGroup = card.querySelector<SVGGElement>(".chart-sel");
  const dimBefore = card.querySelector<SVGRectElement>('.chart-sel-dim[data-side="before"]');
  const dimAfter = card.querySelector<SVGRectElement>('.chart-sel-dim[data-side="after"]');
  const edgeBefore = card.querySelector<SVGLineElement>('.chart-sel-edge[data-side="before"]');
  const edgeAfter = card.querySelector<SVGLineElement>('.chart-sel-edge[data-side="after"]');
  const legend = card.querySelector<HTMLElement>(".climb-legend");
  const readout = card.querySelector<HTMLElement>(".climb-selection");

  if (!svg || !selGroup || !dimBefore || !dimAfter || !edgeBefore || !edgeAfter) return null;
  if (!legend || !readout) return null;

  return { svg, selGroup, dimBefore, dimAfter, edgeBefore, edgeAfter, legend, readout };
}

/**
 * Pointer position → x in viewBox units.
 *
 * The SVG is rendered `preserveAspectRatio="none"`, so the viewBox maps linearly
 * onto the rendered box and a plain proportional scale is exact.
 */
function pointerToChartX(svg: SVGSVGElement, clientX: number): number {
  const rect = svg.getBoundingClientRect();
  if (rect.width === 0) return CHART_PLOT.left;
  return ((clientX - rect.left) / rect.width) * CHART_PLOT.viewBoxW;
}

/** Renders the dim/edge overlay for a range, in viewBox coordinates. */
function paintSelection(parts: ChartParts, x0: number, x1: number): void {
  const left = Math.max(CHART_PLOT.left, Math.min(x0, x1));
  const right = Math.min(CHART_PLOT.right, Math.max(x0, x1));

  parts.dimBefore.setAttribute("x", String(CHART_PLOT.left));
  parts.dimBefore.setAttribute("width", String(Math.max(0, left - CHART_PLOT.left)));
  parts.dimAfter.setAttribute("x", String(right));
  parts.dimAfter.setAttribute("width", String(Math.max(0, CHART_PLOT.right - right)));

  for (const [edge, x] of [
    [parts.edgeBefore, left],
    [parts.edgeAfter, right],
  ] as const) {
    edge.setAttribute("x1", String(x));
    edge.setAttribute("x2", String(x));
  }

  parts.selGroup.style.display = "";
}

/** Fills the readout row and swaps it in for the colour legend. */
function showReadout(parts: ChartParts, summary: RangeSummary): void {
  const dist =
    summary.distance >= 1000
      ? `${metersToKm(summary.distance, 2)} km`
      : `${Math.round(summary.distance)} m`;

  parts.readout.innerHTML =
    `<span class="csel-stat"><span class="csel-label">${chrome.i18n.getMessage("panelDistance")}</span>` +
    `<span class="csel-value">${dist}</span></span>` +
    `<span class="csel-stat"><span class="csel-label">${chrome.i18n.getMessage("panelAvgGrade")}</span>` +
    `<span class="csel-value">${toPercent(summary.avgGrade)}</span></span>` +
    `<button type="button" class="csel-clear" aria-label="${chrome.i18n.getMessage("panelClearSelection")}">&#10005;</button>`;

  parts.legend.hidden = true;
  parts.readout.hidden = false;
}

/**
 * Makes the card's elevation chart drag-selectable: press and drag horizontally
 * to mark a section, and the colour legend is replaced by that section's
 * distance and average gradient until the selection is cleared.
 *
 * `profile` must be the same simplified profile the chart was drawn from, so
 * the numbers match the curve the user is pointing at.
 */
export function attachChartSelection(
  card: HTMLElement,
  profile: ProfilePoint[],
  totalDistance: number
): void {
  const parts = findChartParts(card);
  if (!parts || profile.length < 2 || totalDistance <= 0) return;

  let anchorClientX = 0;
  let anchorDistance = 0;
  /** A pointer is down on the chart. */
  let dragging = false;
  /** The pointer has travelled far enough this gesture to count as a drag. */
  let dragMoved = false;
  /** A selection is currently on screen. Outlives the gesture that made it. */
  let hasSelection = false;

  const clear = (): void => {
    parts.selGroup.style.display = "none";
    parts.readout.hidden = true;
    parts.readout.replaceChildren();
    parts.legend.hidden = false;
    hasSelection = false;
    dragMoved = false;
    document.removeEventListener("keydown", onKeyDown);
    if (clearActiveSelection === clear) clearActiveSelection = null;
  };

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && hasSelection) {
      event.stopPropagation();
      clear();
    }
  }

  const update = (clientX: number): RangeSummary => {
    const distance = chartXToDistance(pointerToChartX(parts.svg, clientX), totalDistance);
    const summary = summarizeRange(profile, anchorDistance, distance);
    paintSelection(
      parts,
      distanceToChartX(summary.start, totalDistance),
      distanceToChartX(summary.end, totalDistance)
    );
    showReadout(parts, summary);
    return summary;
  };

  parts.svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    // Note: no preventDefault here — it would also stop the card from taking
    // focus. Text selection during the drag is suppressed in CSS instead.

    if (clearActiveSelection && clearActiveSelection !== clear) clearActiveSelection();

    anchorClientX = event.clientX;
    anchorDistance = chartXToDistance(pointerToChartX(parts.svg, event.clientX), totalDistance);
    dragging = true;
    // Each gesture re-earns its drag status. Reusing `hasSelection` here would
    // let a plain click on a chart that already has a selection be read as a
    // drag, replacing it with a zero-length range and swallowing the click.
    dragMoved = false;
    parts.svg.setPointerCapture(event.pointerId);
  });

  parts.svg.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    if (!dragMoved) {
      if (Math.abs(event.clientX - anchorClientX) < MIN_DRAG_PX) return;
      dragMoved = true;
      hasSelection = true;
      clearActiveSelection = clear;
      document.addEventListener("keydown", onKeyDown);
    }
    update(event.clientX);
  });

  const finish = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    if (parts.svg.hasPointerCapture(event.pointerId))
      parts.svg.releasePointerCapture(event.pointerId);

    if (!dragMoved) {
      // A plain click: drop any selection and let it reach the card, which
      // centres the map on this climb.
      clear();
      return;
    }
    update(event.clientX);
    // A drag ends with a synthetic `click` on the card. Swallow it during the
    // capture phase so the map does not jump while the user is measuring.
    card.addEventListener("click", swallowClick, { capture: true, once: true });
  };

  function swallowClick(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
  }

  parts.svg.addEventListener("pointerup", finish);
  parts.svg.addEventListener("pointercancel", finish);

  parts.readout.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest(".csel-clear")) return;
    event.stopPropagation();
    clear();
  });
}
