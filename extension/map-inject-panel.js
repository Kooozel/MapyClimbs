/**
 * map-inject-panel.js — Sidebar climb analysis panel DOM builder.
 * Depends on: map-inject-chart.js (generateElevationChart)
 *
 * Public:
 *   buildPanel(climbs, totalRouteDistance) → HTMLElement
 *   showChartOverlay(container)
 *   hideChartOverlay()
 */

// ── Category helpers ─────────────────────────────────────────────────────────

function getCategoryClass(cat) {
  return cat === 'HC' ? 'hc' : cat === '1' ? 'cat1' : cat === '2' ? 'cat2' : cat === '3' ? 'cat3' : 'cat4';
}

function getCategoryColor(cat) {
  return { HC: '#800020', '1': '#D32F2F', '2': '#F57C00', '3': '#FBC02D', '4': '#4CAF50' }[cat] || '#4CAF50';
}

// ── Climb metrics ─────────────────────────────────────────────────────────────

/**
 * Returns the steepest average gradient over any consecutive segment window
 * of at least `minDistance` metres. Prevents single-point GPS noise from
 * inflating the displayed max grade.
 */
function calcMaxGradientOver(segments, minDistance) {
  let best = 0;
  for (let i = 0; i < segments.length; i++) {
    let dist = 0, elev = 0;
    for (let j = i; j < segments.length; j++) {
      dist += segments[j].distance;
      elev += segments[j].elevation;
      if (dist >= minDistance) {
        best = Math.max(best, (elev / dist) * 100);
        break;
      }
    }
  }
  return best;
}

function calcVAM(climb) {
  const speedKmh = 12 / (1 + climb.avgGrade / 5);
  return Math.round(speedKmh * climb.avgGrade * 10);
}

function estimateClimbTime(climb) {
  const speedKmh = 12 / (1 + climb.avgGrade / 5);
  return (climb.distance / 1000) / speedKmh * 60;
}

function calcFiets(climb) {
  const distKm = climb.distance / 1000;
  if (distKm === 0) return 0;
  return (climb.elevation * climb.elevation) / distKm / 1000;
}

// ── Panel sections ────────────────────────────────────────────────────────────

function buildRouteOverview(totalDistance, totalElevGain, maxGradient, climbs) {
  const distKm     = (totalDistance / 1000).toFixed(1);
  const climbingKm = (climbs.reduce((s, c) => s + c.distance, 0) / 1000).toFixed(1);

  let stripSegments = '', stripLabels = '';
  climbs.forEach((climb, i) => {
    const startPct = (climb.segments[0].startDistance / totalDistance) * 100;
    const endPct   = (climb.segments[climb.segments.length - 1].endDistance / totalDistance) * 100;
    const widthPct = endPct - startPct;
    const color    = getCategoryColor(climb.category);
    const midPct   = startPct + widthPct / 2;
    stripSegments += `<div class="strip-segment" style="left:${startPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;background:${color};opacity:0.85;" title="Climb ${i + 1}: Cat ${climb.category}"></div>`;
    if (widthPct > 4) {
      stripLabels += `<span class="strip-label" style="left:${midPct.toFixed(1)}%">${i + 1}</span>`;
    }
  });

  return `
    <div class="route-overview">
      <div class="route-overview-title">Route overview</div>
      <div class="route-stats-row">
        <div class="rstat"><span class="rstat-value">${distKm}</span><span class="rstat-label">km total</span></div>
        <div class="rstat"><span class="rstat-value">+${Math.round(totalElevGain)}</span><span class="rstat-label">m climbing</span></div>
        <div class="rstat"><span class="rstat-value">${maxGradient.toFixed(1)}%</span><span class="rstat-label">max grade</span></div>
        <div class="rstat"><span class="rstat-value">${climbingKm}</span><span class="rstat-label">km climbs</span></div>
      </div>
      <div class="route-strip-wrap">
        <div class="route-strip">${stripSegments}</div>
        ${stripLabels}
      </div>
    </div>`;
}

function buildClimbCard(climb, index, totalRouteDistance) {
  const catClass = getCategoryClass(climb.category);
  const maxGrad  = calcMaxGradientOver(climb.segments, 200);

  // Summit = segment point with maximum elevation
  let summitElev = -Infinity, summitDist = 0;
  for (const seg of climb.segments) {
    if (seg.startElevation > summitElev) { summitElev = seg.startElevation; summitDist = seg.startDistance; }
    if (seg.endElevation   > summitElev) { summitElev = seg.endElevation;   summitDist = seg.endDistance; }
  }

  const timeMin = estimateClimbTime(climb);
  const timeStr = timeMin >= 60
    ? `${Math.floor(timeMin / 60)}h ${Math.round(timeMin % 60)}min`
    : `${Math.round(timeMin)} min`;

  const chart = generateElevationChart(climb.segments, climb.distance, climb.category);

  const peakSvg =
    '<svg class="summit-icon" width="11" height="10" viewBox="0 0 11 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M1 9.5L5.5 0.5L10 9.5H1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' +
    '<path d="M3.5 5.5L5.5 0.5L7.5 5.5H3.5Z" fill="currentColor" opacity="0.45"/>' +
    '</svg>';

  return `
    <div class="climb-item ${catClass}">
      <div class="climb-header">
        <div class="climb-title-group">
          <span class="climb-name">Climb ${index + 1}</span>
          <span class="climb-badge">Cat ${climb.category}</span>
        </div>
      </div>
      <div class="climb-stats">
        <div class="stat"><span class="stat-label">Distance</span><span class="stat-value">${(climb.distance / 1000).toFixed(2)} km</span></div>
        <div class="stat"><span class="stat-label">Elevation</span><span class="stat-value highlight">+${Math.round(climb.elevation)} m</span></div>
        <div class="stat"><span class="stat-label">Avg grade</span><span class="stat-value">${climb.avgGrade.toFixed(1)}%</span></div>
      </div>
      <div class="climb-stats secondary-stats">
        <div class="stat"><span class="stat-label">Max grade</span><span class="stat-value stat-secondary">${maxGrad.toFixed(1)}%</span></div>
        <div class="stat"><span class="stat-label">Summit</span><span class="stat-value stat-secondary stat-summit">${peakSvg}${Math.round(summitElev)} m</span></div>
        <div class="stat"><span class="stat-label">Summit at</span><span class="stat-value stat-secondary">${(summitDist / 1000).toFixed(1)} km</span></div>
      </div>
      <div class="climb-meta">
        <div class="climb-meta-item"><span class="climb-meta-label">Est. time</span><span class="climb-meta-value">${timeStr}</span></div>
        <div class="climb-meta-item"><span class="climb-meta-label">VAM</span><span class="climb-meta-value">${calcVAM(climb)} m/h</span></div>
        <div class="climb-meta-item"><span class="climb-meta-label">Fiets index</span><span class="climb-meta-value">${calcFiets(climb).toFixed(1)}</span></div>
      </div>
      ${chart}
    </div>`;
}

/**
 * Build the full sidebar panel element.
 * @param {Climb[]|null} climbs
 * @param {number}       totalRouteDistance  metres
 * @returns {HTMLElement}
 */
function buildPanel(climbs, totalRouteDistance) {
  const panel = document.createElement('div');
  panel.id = 'climb-inject-panel';

  if (!climbs || climbs.length === 0) {
    panel.innerHTML = `
      <div class="cip-header-bar">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 17 9 11 13 15 21 7"/>
          <polyline points="14 7 21 7 21 14"/>
        </svg>
        <span>Climb Analyzer</span>
      </div>
      <p class="cip-empty">No climbs detected on this route.</p>`;
    return panel;
  }

  const totalDist     = totalRouteDistance ||
                        Math.max(...climbs.flatMap(c => c.segments).map(s => s.endDistance));
  const totalElevGain = climbs.reduce((s, c) => s + c.elevation, 0);
  const maxGradient   = calcMaxGradientOver(climbs.flatMap(c => c.segments), 200);

  let inner = buildRouteOverview(totalDist, totalElevGain, maxGradient, climbs);
  inner += `<div class="section-label">${climbs.length} climb${climbs.length !== 1 ? 's' : ''} detected</div>`;
  climbs.forEach((climb, i) => { inner += buildClimbCard(climb, i, totalDist); });

  panel.innerHTML = `
    <button class="cip-header-bar cip-toggle" aria-expanded="true">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="3 17 9 11 13 15 21 7"/>
        <polyline points="14 7 21 7 21 14"/>
      </svg>
      <span>Climb Analyzer</span>
      <svg class="cip-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>
    <div class="cip-body"><div class="cip-inner">${inner}</div></div>`;

  const toggleBtn = panel.querySelector('.cip-toggle');
  const body      = panel.querySelector('.cip-body');
  toggleBtn.addEventListener('click', () => {
    const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!expanded));
    body.style.display = expanded ? 'none' : '';
    panel.querySelector('.cip-chevron').style.transform = expanded ? 'rotate(-90deg)' : '';
  });

  panel.querySelectorAll('.climb-profile-container').forEach(c => {
    c.addEventListener('mouseenter', () => showChartOverlay(c));
    c.addEventListener('mouseleave', hideChartOverlay);
  });

  return panel;
}

// ── Chart hover overlay ───────────────────────────────────────────────────────

function showChartOverlay(container) {
  hideChartOverlay();
  const svg = container.querySelector('svg');
  if (!svg) return;

  const rect  = container.getBoundingClientRect();
  const W = 600, H = 220;
  const right = Math.round(window.innerWidth - rect.right);
  const top   = Math.max(8, Math.min(Math.round(rect.top + rect.height / 2 - H / 2), window.innerHeight - H - 8));

  const overlay = document.createElement('div');
  overlay.id = 'cip-chart-expand';
  overlay.style.cssText =
    'position:fixed;right:' + right + 'px;top:' + top + 'px;' +
    'width:' + W + 'px;height:' + H + 'px;z-index:2147483646;border-radius:8px;overflow:hidden;' +
    'pointer-events:none;box-shadow:0 8px 32px rgba(0,0,0,0.75);' +
    'border:1px solid rgba(61,158,110,0.45);';

  const clonedSvg = svg.cloneNode(true);
  clonedSvg.setAttribute('preserveAspectRatio', 'none');
  clonedSvg.style.cssText = 'width:100%;height:100%;display:block;border-radius:0;';
  overlay.appendChild(clonedSvg);
  document.body.appendChild(overlay);
}

function hideChartOverlay() {
  const el = document.getElementById('cip-chart-expand');
  if (el) el.remove();
}
