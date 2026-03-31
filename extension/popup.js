/**
 * Popup Script â€” Mapy.cz Climb Analyzer
 */

let currentClimbs = null;
let currentElevationFile = null;
let currentElevationData = null;
let popupPort = null;
let pollingInterval = null;

// â”€â”€â”€ Lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function keepPopupAlive() {
  try {
    popupPort = chrome.runtime.connect({ name: 'popup' });
    popupPort.onMessage.addListener((msg) => {
      if (msg.type === 'GPX_CAPTURED') checkForCapturedGPX();
    });
    popupPort.onDisconnect.addListener(() => {
      setTimeout(keepPopupAlive, 1000);
    });
  } catch (e) {
    console.log('[Popup] Port unavailable:', e.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  keepPopupAlive();
  checkForCapturedGPX();
  pollingInterval = setInterval(checkForCapturedGPX, 2000);
});

// â”€â”€â”€ GPX capture flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function checkForCapturedGPX() {
  chrome.storage.local.get(['pendingGPX', 'gpxCaptureTime'], (result) => {
    if (result.pendingGPX) {
      showCaptureBadge();
      processAndDisplayGPX(result.pendingGPX);
      return;
    }
    try {
      const gpx = sessionStorage.getItem('pendingGPX');
      if (gpx) { showCaptureBadge(); processAndDisplayGPX(gpx); }
    } catch (_) {}
  });
}

function showCaptureBadge() {
  const badge = document.getElementById('capture-badge');
  if (badge) badge.style.display = 'flex';
}

function processAndDisplayGPX(gpxContent) {
  hide('upload-section');
  show('status-info');
  analyzeGPXContent(gpxContent);
  chrome.storage.local.remove(['pendingGPX', 'gpxCaptureTime']);
}

// â”€â”€â”€ Event listeners â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function setupEventListeners() {
  const fileInput  = document.getElementById('gpx-file-input');
  const analyzeBtn = document.getElementById('analyze-btn');
  const clearBtn   = document.getElementById('clear-btn');
  const copyBtn    = document.getElementById('copy-btn');

  fileInput?.addEventListener('change', (e) => {
    currentElevationFile = e.target.files[0] || null;
    if (currentElevationFile) analyzeGPXFile();
  });

  analyzeBtn?.addEventListener('click', analyzeGPXFile);

  clearBtn?.addEventListener('click', () => {
    currentClimbs = null;
    currentElevationFile = null;
    currentElevationData = null;
    document.getElementById('gpx-file-input').value = '';
    document.getElementById('capture-badge').style.display = 'none';
    hide('climbs-list'); hide('status-info'); hide('no-data'); hide('error-message');
    show('upload-section');
  });

  copyBtn?.addEventListener('click', copySummary);
}

// â”€â”€â”€ Analysis pipeline â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function analyzeGPXFile() {
  if (!currentElevationFile) { showError('Please select a GPX file first'); return; }
  showLoading();
  loadGPXFile(currentElevationFile)
    .then(analyzeElevationProfile)
    .catch((e) => { showError(`Failed to parse GPX: ${e.message}`); hide('status-info'); });
}

function analyzeGPXContent(gpxContent) {
  showLoading();
  try {
    analyzeElevationProfile(parseGPX(gpxContent));
  } catch (e) {
    showError(`Failed to parse GPX: ${e.message}`);
    hide('status-info');
  }
}

function analyzeElevationProfile(elevationProfile) {
  currentElevationData = elevationProfile;

  const timeout = setTimeout(() => {
    showError('Processing timed out. Please try again.');
    hide('status-info');
  }, 8000);

  chrome.runtime.sendMessage({ type: 'PROCESS_CLIMBS', elevation: elevationProfile }, (response) => {
    clearTimeout(timeout);
    if (chrome.runtime.lastError) {
      showError('Error communicating with background worker');
      hide('status-info');
      return;
    }
    if (response?.climbs !== undefined) {
      currentClimbs = response.climbs;
      displayClimbs(response.climbs, elevationProfile);
    } else {
      showError('Unexpected response from background worker');
      hide('status-info');
    }
  });
}

// â”€â”€â”€ Display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function displayClimbs(climbs, elevationProfile) {
  hide('status-info'); hide('error-message');

  if (!climbs || climbs.length === 0) {
    show('no-data'); hide('climbs-list'); return;
  }

  hide('no-data'); hide('upload-section');
  const climbsList = document.getElementById('climbs-list');
  climbsList.style.display = 'flex';

  const totalDistance     = elevationProfile[elevationProfile.length - 1][0];
  const totalElevGain     = climbs.reduce((s, c) => s + c.elevation, 0);
  const maxGradient       = climbs.flatMap(c => c.segments).reduce((m, s) => Math.max(m, s.gradient), 0);
  const totalClimbingDist = climbs.reduce((s, c) => s + c.distance, 0);

  let html = buildRouteOverview(totalDistance, totalElevGain, maxGradient, climbs);
  html += `<div class="section-label">${climbs.length} climb${climbs.length !== 1 ? 's' : ''} detected</div>`;

  climbs.forEach((climb, i) => {
    html += buildClimbCard(climb, i, totalDistance);
  });

  climbsList.innerHTML = html;
}

// â”€â”€â”€ Route overview strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildRouteOverview(totalDistance, totalElevGain, maxGradient, climbs) {
  const distKm = (totalDistance / 1000).toFixed(1);
  const climbingKm = (climbs.reduce((s, c) => s + c.distance, 0) / 1000).toFixed(1);

  let stripSegments = '';
  let stripLabels   = '';

  climbs.forEach((climb, i) => {
    const startPct = (climb.segments[0].startDistance / totalDistance) * 100;
    const endPct   = (climb.segments[climb.segments.length - 1].endDistance / totalDistance) * 100;
    const widthPct = endPct - startPct;
    const color    = getCategoryColor(climb.category);
    const midPct   = startPct + widthPct / 2;

    stripSegments += `<div class="strip-segment" style="left:${startPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;background:${color};opacity:0.85;" title="Climb ${i+1}: Cat ${climb.category}"></div>`;
    if (widthPct > 4) {
      stripLabels += `<span class="strip-label" style="left:${midPct.toFixed(1)}%">${i + 1}</span>`;
    }
  });

  return `
    <div class="route-overview">
      <div class="route-overview-title">Route overview</div>
      <div class="route-stats-row">
        <div class="rstat">
          <span class="rstat-value">${distKm}</span>
          <span class="rstat-label">km total</span>
        </div>
        <div class="rstat">
          <span class="rstat-value">+${Math.round(totalElevGain)}</span>
          <span class="rstat-label">m climbing</span>
        </div>
        <div class="rstat">
          <span class="rstat-value">${maxGradient.toFixed(1)}%</span>
          <span class="rstat-label">max grade</span>
        </div>
        <div class="rstat">
          <span class="rstat-value">${climbingKm}</span>
          <span class="rstat-label">km climbs</span>
        </div>
      </div>
      <div class="route-strip-wrap">
        <div class="route-strip">
          ${stripSegments}
        </div>
        ${stripLabels}
      </div>
    </div>
  `;
}

// â”€â”€â”€ Climb card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function buildClimbCard(climb, index, totalRouteDistance) {
  const catClass  = getCategoryClass(climb.category);
  const startKm   = (climb.segments[0].startDistance / 1000).toFixed(1);
  const endKm     = (climb.segments[climb.segments.length - 1].endDistance / 1000).toFixed(1);
  const startElev = Math.round(climb.segments[0].startElevation);
  const endElev   = Math.round(climb.segments[climb.segments.length - 1].endElevation);
  const maxGrad   = Math.max(...climb.segments.map(s => s.gradient));

  const vam         = calcVAM(climb);
  const timeMin     = estimateClimbTime(climb);
  const timeStr     = timeMin >= 60
    ? `${Math.floor(timeMin / 60)}h ${Math.round(timeMin % 60)}min`
    : `${Math.round(timeMin)} min`;

  const chart = generateElevationChart(climb.segments, climb.distance);

  return `
    <div class="climb-item ${catClass}">
      <div class="climb-header">
        <div class="climb-title-group">
          <span class="climb-name">Climb ${index + 1}</span>
          <span class="climb-badge">Cat ${climb.category}</span>
        </div>
        <span class="climb-score">Score&nbsp;${Math.round(climb.difficulty).toLocaleString()}</span>
      </div>

      <div class="climb-stats">
        <div class="stat">
          <span class="stat-label">Distance</span>
          <span class="stat-value">${(climb.distance / 1000).toFixed(2)} km</span>
        </div>
        <div class="stat">
          <span class="stat-label">Elevation</span>
          <span class="stat-value highlight">+${Math.round(climb.elevation)} m</span>
        </div>
        <div class="stat">
          <span class="stat-label">Avg grade</span>
          <span class="stat-value">${climb.avgGrade.toFixed(1)}%</span>
        </div>
        <div class="stat">
          <span class="stat-label">Max grade</span>
          <span class="stat-value">${maxGrad.toFixed(1)}%</span>
        </div>
        <div class="stat">
          <span class="stat-label">Position</span>
          <span class="stat-value">${startKm}&ndash;${endKm} km</span>
        </div>
        <div class="stat">
          <span class="stat-label">Elev range</span>
          <span class="stat-value">${startElev}&ndash;${endElev} m</span>
        </div>
      </div>

      <div class="climb-meta">
        <div class="climb-meta-item">
          <span class="climb-meta-label">Est. time</span>
          <span class="climb-meta-value">${timeStr}</span>
        </div>
        <div class="climb-meta-item">
          <span class="climb-meta-label">VAM</span>
          <span class="climb-meta-value">${vam} m/h</span>
        </div>
        <div class="climb-meta-item">
          <span class="climb-meta-label">Fiets index</span>
          <span class="climb-meta-value">${calcFiets(climb).toFixed(1)}</span>
        </div>
      </div>

      ${chart}
    </div>
  `;
}

// â”€â”€â”€ Cycling metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * VAM = VelocitÃ  Ascensionale Media (vertical meters per hour).
 * Assumes a recreationalâ€“sportive cyclist maintaining ~200W equivalent effort.
 * We estimate speed from gradient using an empirical fit:
 *   speed_kmh â‰ˆ 12 / (1 + avgGrade / 5)   (reasonable for 200W on 70kg+bike)
 * Then VAM = speed_kmh Ã— avgGrade% Ã— 10
 */
function calcVAM(climb) {
  const avgGrade = climb.avgGrade;
  const speedKmh = 12 / (1 + avgGrade / 5);
  const vam = Math.round(speedKmh * avgGrade * 10);
  return vam;
}

/**
 * Estimated time to climb for an average recreational road cyclist.
 * Uses the same speed model as VAM: speed â‰ˆ 12 / (1 + grade/5) km/h
 * Returns minutes.
 */
function estimateClimbTime(climb) {
  const avgGrade = climb.avgGrade;
  const speedKmh = 12 / (1 + avgGrade / 5);
  return (climb.distance / 1000) / speedKmh * 60;
}

/**
 * Fiets index â€” Belgian difficulty formula: (elevÂ² / distKm) / 1000
 * Commonly used for Alpine passes. A proper HC is typically â‰¥ 4000.
 */
function calcFiets(climb) {
  const distKm = climb.distance / 1000;
  if (distKm === 0) return 0;
  return (climb.elevation * climb.elevation) / distKm / 1000;
}

// â”€â”€â”€ Copy summary â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function copySummary() {
  if (!currentClimbs || currentClimbs.length === 0) {
    showError('No climb data to copy. Analyze a GPX first.');
    return;
  }

  const totalDist = currentElevationData
    ? (currentElevationData[currentElevationData.length - 1][0] / 1000).toFixed(1)
    : '?';
  const totalElev  = currentClimbs.reduce((s, c) => s + c.elevation, 0);

  let text = `ðŸš´ Climb Analysis â€” ${totalDist} km / +${Math.round(totalElev)} m\n`;
  text += 'â”€'.repeat(40) + '\n';

  currentClimbs.forEach((c, i) => {
    const t = estimateClimbTime(c);
    const timeStr = t >= 60
      ? `${Math.floor(t / 60)}h ${Math.round(t % 60)}min`
      : `${Math.round(t)} min`;
    const startKm = (c.segments[0].startDistance / 1000).toFixed(1);
    text += `Climb ${i + 1}  Cat ${c.category}  @${startKm} km\n`;
    text += `  ${(c.distance / 1000).toFixed(2)} km  +${Math.round(c.elevation)} m  avg ${c.avgGrade.toFixed(1)}%  ~${timeStr}\n`;
  });

  text += 'â”€'.repeat(40) + '\n';
  text += `Analyzed with Mapy.cz Climb Analyzer`;

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-btn');
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = 'âœ“ Copied';
      btn.style.color = '#5ecb96';
      setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 2000);
    }
  }).catch(() => showError('Could not copy to clipboard'));
}

// â”€â”€â”€ SVG chart â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function generateElevationChart(segments, totalDistanceMeters) {
  if (!segments || segments.length === 0) return '';

  let profile = [];
  let cumulDist = 0;
  for (const seg of segments) {
    profile.push({ distance: cumulDist, elevation: seg.startElevation, gradient: seg.gradient });
    cumulDist += seg.distance;
  }
  profile.push({
    distance: cumulDist,
    elevation: segments[segments.length - 1].endElevation,
    gradient: 0
  });

  if (profile.length < 2) return '';
  return renderElevationSVG(simplifyElevationProfile(profile), cumulDist);
}

function simplifyElevationProfile(profile) {
  if (profile.length <= 3) return profile;

  const maxSegs = Math.min(20, Math.max(8, Math.ceil(profile.length / 3)));
  let keys = [0];

  const grads = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const dE = profile[i + 1].elevation - profile[i].elevation;
    const dD = profile[i + 1].distance  - profile[i].distance;
    grads.push(dD > 0 ? (dE / dD) * 100 : 0);
  }

  for (let i = 1; i < grads.length - 1; i++) {
    if (Math.abs(grads[i] - grads[i - 1]) >= 1.5) keys.push(i);
  }
  keys.push(profile.length - 1);

  if (keys.length > maxSegs) {
    keys = [0];
    const step = Math.floor(profile.length / maxSegs);
    for (let i = step; i < profile.length - 1; i += step) keys.push(i);
    keys.push(profile.length - 1);
  }

  return [...new Set(keys)].sort((a, b) => a - b).map(i => profile[i]);
}

function renderElevationSVG(profile, totalDistance) {
  if (profile.length < 2) return '';

  const elevs    = profile.map(p => p.elevation);
  const minElev  = Math.min(...elevs);
  const maxElev  = Math.max(...elevs);
  const elevRange = maxElev - minElev;
  if (elevRange === 0) return '';

  const W = 440, H = 120;
  const M = { left: 42, right: 12, top: 10, bottom: 28 };
  const cW = W - M.left - M.right;
  const cH = H - M.top  - M.bottom;

  const sx   = d  => M.left + (d / (totalDistance || 1)) * cW;
  const sy   = el => H - M.bottom - ((el - minElev) / elevRange) * cH;
  const base = H - M.bottom;

  let fills = '', lines = '';
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i], b = profile[i + 1];
    const dD = b.distance - a.distance;
    const g  = dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
    const col = g < 3 ? '#44aa88' : g < 6 ? '#cccc55' : g < 9 ? '#ff8833' : g < 12 ? '#ee3333' : '#880000';
    const x1 = sx(a.distance).toFixed(1), y1 = sy(a.elevation).toFixed(1);
    const x2 = sx(b.distance).toFixed(1), y2 = sy(b.elevation).toFixed(1);
    fills += `<polygon points="${x1},${base} ${x2},${base} ${x2},${y2} ${x1},${y1}" fill="${col}" opacity="0.75"/>`;
    lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="2" stroke-linecap="round"/>`;
  }

  // Y-axis
  let yAxis = '';
  for (let i = 0; i < 4; i++) {
    const r = i / 3;
    const el = minElev + r * elevRange;
    const y  = sy(el).toFixed(1);
    yAxis += `<line x1="${M.left - 4}" y1="${y}" x2="${M.left}" y2="${y}" stroke="#444" stroke-width="0.5"/>`;
    yAxis += `<text x="${M.left - 6}" y="${y}" dy="0.35em" font-size="10" fill="#666" text-anchor="end">${Math.round(el)}</text>`;
    if (i > 0 && i < 3) {
      yAxis += `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="#252930" stroke-width="0.5"/>`;
    }
  }

  // X-axis labels
  let xAxis = '';
  const labelCount = totalDistance >= 5000 ? 5 : 4;
  for (let i = 0; i < labelCount; i++) {
    const r  = i / (labelCount - 1);
    const d  = r * totalDistance;
    const x  = sx(d).toFixed(1);
    const lbl = totalDistance >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`;
    xAxis += `<text x="${x}" y="${H - 6}" font-size="9" fill="#555" text-anchor="middle">${lbl}</text>`;
  }

  return `
    <div class="climb-profile-container">
      <svg viewBox="0 0 ${W} ${H}" class="profile-svg" xmlns="http://www.w3.org/2000/svg">
        <rect width="${W}" height="${H}" fill="#111316"/>
        ${fills}
        <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${base}" stroke="#333" stroke-width="1"/>
        <line x1="${M.left}" y1="${base}" x2="${W - M.right}" y2="${base}" stroke="#333" stroke-width="1"/>
        ${yAxis}
        ${lines}
        ${xAxis}
      </svg>
    </div>`;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getCategoryClass(cat) {
  return cat === 'HC' ? 'hc' : cat === '1' ? 'cat1' : cat === '2' ? 'cat2' : cat === '3' ? 'cat3' : 'cat4';
}

function getCategoryColor(cat) {
  return { HC: '#d42b2b', '1': '#e85d17', '2': '#e8a117', '3': '#c8c022', '4': '#6b7280' }[cat] || '#6b7280';
}

function show(id) { const el = document.getElementById(id); if (el) el.style.display = ''; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

function showLoading() {
  hide('upload-section'); hide('climbs-list'); hide('no-data'); hide('error-message');
  show('status-info');
}

function showError(message) {
  const el = document.getElementById('error-message');
  if (!el) return;
  el.textContent = message;
  show('error-message');
  hide('status-info');
}
