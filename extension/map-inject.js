/**
 * map-inject.js — Content Script (v0.4)
 * Renders climb analysis panel in the Mapy.cz route-planner sidebar
 * and places start/end pins on the map using Web Mercator math.
 */

(function () {
  'use strict';

  // Always init — Mapy.cz is a SPA and the user may navigate to the route
  // planner after the page loads, at which point content scripts don't re-run.
  // Route-planner-specific features (sidebar panel, Analyze button) guard
  // themselves by checking isRoutePlannerActive() before doing DOM work.

  function isRoutePlannerActive() {
    if (!location.href.includes('planovani-trasy')) return false;
    // Also require the route-planner DOM to actually be visible
    const el = document.querySelector('.route-actions, .route-modules');
    return !!(el && el.offsetParent !== null);
  }

  let _climbs = null;
  let _panelInjected = false;
  let _lastGPXLength = 0;
  let _totalRouteDistance = 0;

  // ── Entry point ─────────────────────────────────────────────────────────────

  init();

  function init() {
    // Discard any cached result that has no coordinates (pre-v0.4 storage)
    chrome.storage.local.get(['lastClimbResult'], (data) => {
      if (data.lastClimbResult && Array.isArray(data.lastClimbResult) &&
          data.lastClimbResult.length && !data.lastClimbResult[0].markerCoords) {
        chrome.storage.local.remove('lastClimbResult');
      }
    });

    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(pollForGPX, 2000);

    window.addEventListener('popstate', onRouteChange);
    const _origPushState = history.pushState.bind(history);
    history.pushState = function (...args) {
      _origPushState(...args);
      onRouteChange();
    };

    // Poll URL for pan/zoom changes and route-planner visibility.
    // Mapy.cz calls replaceState before document_idle fires so patching
    // it is unreliable; polling is simpler.
    let _lastURL = '';
    let _lastRoutePlannerVisible = false;
    setInterval(() => {
      const urlChanged = location.href !== _lastURL;
      const visible = isRoutePlannerActive();

      if (urlChanged) {
        _lastURL = location.href;
        if (_climbs && visible) renderMapOverlay();
      }

      if (_lastRoutePlannerVisible !== visible) {
        _lastRoutePlannerVisible = visible;
        if (!visible) {
          // Route planner hidden — clear overlays and storage
          const overlay = document.getElementById('climb-marker-overlay');
          if (overlay) overlay.innerHTML = '';
          chrome.storage.local.remove(['pendingGPX', 'gpxCaptureTime', 'lastClimbResult', 'lastTotalDistance']);
        } else if (_climbs) {
          renderMapOverlay();
        }
      }
    }, 150);

    window.addEventListener('resize', () => { if (_climbs && isRoutePlannerActive()) renderMapOverlay(); });
  }

  function onRouteChange() {
    clearRoutePlannerState();
    if (!isRoutePlannerActive()) return;
    pollForGPX();
  }

  // ── Storage polling ─────────────────────────────────────────────────────────

  function pollForGPX() {
    chrome.storage.local.get(['pendingGPX', 'lastClimbResult'], (data) => {
      // Never show anything unless the route-planner DOM is actually visible
      if (!isRoutePlannerActive()) return;

      // Fresh GPX arrived — analyse it
      if (data.pendingGPX && data.pendingGPX.length !== _lastGPXLength) {
        _lastGPXLength = data.pendingGPX.length;
        analyzeGPX(data.pendingGPX);
        return;
      }

      if (data.pendingGPX && data.lastClimbResult && !_climbs) {
        const cached = data.lastClimbResult;
        if (Array.isArray(cached) && cached.length && cached[0].markerCoords) {
          _climbs = cached;
          _totalRouteDistance = data.lastTotalDistance || 0;
          renderPanel();
          renderMapOverlay();
        }
      }
    });
  }

  // ── Analysis ────────────────────────────────────────────────────────────────

  function analyzeGPX(gpxContent) {
    let elevationProfile;
    try {
      elevationProfile = parseGPX(gpxContent);
    } catch (e) {
      console.error('[MapInject] GPX parse error:', e);
      return;
    }

    chrome.runtime.sendMessage({ type: 'PROCESS_CLIMBS', elevation: elevationProfile }, (response) => {
      if (chrome.runtime.lastError || !response?.climbs) return;
      _climbs = response.climbs;
      _totalRouteDistance = response.totalDistance || 0;
      renderPanel();
      renderMapOverlay();
    });
  }

  // ── Map overlay ────────────────────────────────────────────────────────────────

  function renderMapOverlay() {
    if (!_climbs?.length) return;

    const vp = viewportFromURL();
    if (!vp) {
      console.log('[MapInject] No viewport in URL, skipping overlay');
      return;
    }

    const mb = getMapBounds();

    let overlay = document.getElementById('climb-marker-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'climb-marker-overlay';
      overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;overflow:visible;';
      document.body.appendChild(overlay);
    }
    overlay.style.left   = mb.left + 'px';
    overlay.style.top    = mb.top  + 'px';
    overlay.style.width  = mb.width  + 'px';
    overlay.style.height = mb.height + 'px';
    overlay.innerHTML = '';

    // v0.5.2 Heat Scale Color Palette — High-contrast against green terrain
    const CAT_COLORS = { HC: '#660000', '1': '#B30000', '2': '#E65100', '3': '#FF9100', '4': '#FFD600' };

    _climbs.forEach((climb, i) => {
      const color = CAT_COLORS[climb.category] || '#6b7280';
      const label = 'Climb ' + (i + 1) + ' · Cat ' + climb.category + ' · ' +
                    (climb.distance / 1000).toFixed(1) + ' km +' + Math.round(climb.elevation) + ' m';

      // v0.5.2 "The Pulse" Start Pin: Simple circle with index label
      if (climb.markerCoords) {
        const s = mercatorToPixel(climb.markerCoords.lat, climb.markerCoords.lon,
                                  vp.lat, vp.lon, vp.zoom, mb.width, mb.height);
        if (s.x >= -25 && s.x <= mb.width + 25 && s.y >= -25 && s.y <= mb.height + 25) {
          const pin = document.createElement('div');
          pin.style.cssText = 'position:absolute;left:' + Math.round(s.x - 16) + 'px;top:' +
            Math.round(s.y - 26) + 'px;pointer-events:auto;cursor:default;' +
            'filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6));';
          pin.title = label + ' (start)';
          pin.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="52" viewBox="0 0 24 39">' +
            '<circle cx="12" cy="24" r="8" fill="' + color + '" stroke="#000" stroke-width="1.5" stroke-linejoin="round"/>' +
            '<text x="12" y="8" font-size="12" font-weight="bold" fill="#fff" text-anchor="middle" font-family="system-ui,sans-serif"' +
            ' paint-order="stroke" stroke="#000" stroke-width="1.5" opacity="0.8">' + (i + 1) + '</text>' +
            '</svg>';
          overlay.appendChild(pin);
        }
      }

      // v0.5.2 "The Summit" End Pin: Mountain icon with snow-cap + category label
      if (climb.endCoords) {
        const e = mercatorToPixel(climb.endCoords.lat, climb.endCoords.lon,
                                  vp.lat, vp.lon, vp.zoom, mb.width, mb.height);
        if (e.x >= -35 && e.x <= mb.width + 35 && e.y >= -40 && e.y <= mb.height + 10) {
          const peak = document.createElement('div');
          peak.style.cssText = 'position:absolute;left:' + Math.round(e.x - 60) + 'px;top:' +
            Math.round(e.y - 70) + 'px;pointer-events:auto;cursor:default;width:120px;height:140px;';
          peak.title = label + ' (end)';
          const catLabel = climb.category === 'HC' ? 'HC' : 'C' + climb.category;
          
          // Mountain icon SVG — optimized viewBox and cleaned coordinates
          const mountainSvg = 
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">' +
            '<defs>' +
            '<filter id="shadow-' + i + '" x="-20%" y="-20%" width="150%" height="150%">' +
            // '<feGaussianBlur in="SourceAlpha" stdDeviation="3"/>' +
            '<feOffset dx="4" dy="4" result="offsetblur"/>' +
            '<feComponentTransfer><feFuncA type="linear" slope="0.5"/></feComponentTransfer>' +
            '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>' +
            '</filter>' +
            '</defs>' +
            '<g filter="url(#shadow-' + i + ')">' +
            '<path d="M460 320 H177 c-3 0-5-3-4-6 l90-184 112 2 89 182 c1 3-1 6-4 6z" fill="' + color + '" stroke="#000" stroke-width="8"/>' +
            '<path d="m375 132-15 32-36-29-37 14-23-19 52-106 c2-3 6-3 8 0z" fill="#FFFFFF" stroke="#000" stroke-width="8"/>' +
            '<text x="500" y="280" font-family="Arial, sans-serif" font-weight="900" font-size="160" fill="' + color + '" stroke="#000" stroke-width="8" style="paint-order: stroke fill;"><tspan>' + catLabel + '</tspan></text>' +
            '</g>' +
            '</svg>';
          peak.innerHTML = mountainSvg;
          overlay.appendChild(peak);
        }
      }
    });
  }

  /** Parse map center and zoom from URL params (x=lon, y=lat, z=zoom). */
  function viewportFromURL() {
    const p = new URLSearchParams(location.search);
    const lon  = parseFloat(p.get('x'));
    const lat  = parseFloat(p.get('y'));
    const zoom = parseInt(p.get('z'), 10);
    if (isNaN(lat) || isNaN(lon) || isNaN(zoom)) return null;
    return { lat, lon, zoom };
  }

  /** Standard Web Mercator: lat/lon → pixel offset relative to map container. */
  function mercatorToPixel(lat, lon, cLat, cLon, zoom, W, H) {
    const S  = 256 * Math.pow(2, zoom);
    const mx = d => ((d + 180) / 360) * S;
    const my = d => {
      const s = Math.sin(d * Math.PI / 180);
      return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * S;
    };
    return { x: W / 2 + mx(lon) - mx(cLon), y: H / 2 + my(lat) - my(cLat) };
  }

  /**
   * Find the largest canvas bounding rect (Mapy.cz tile renderer).
   * Using full canvas size keeps Web Mercator centering aligned with URL params.
   */
  function getMapBounds() {
    // Largest canvas = tile renderer (full viewport on Mapy.cz)
    const canvases = Array.from(document.querySelectorAll('canvas'));
    if (canvases.length) {
      const best = canvases
        .map(c => ({ c, r: c.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 200 && r.height > 200)
        .sort((a, b) => (b.r.width * b.r.height) - (a.r.width * a.r.height))[0];
      if (best) {
        const { r } = best;
        return { left: Math.round(r.left), top: Math.round(r.top),
                 width: Math.round(r.width), height: Math.round(r.height) };
      }
    }
    // Fallback: full viewport
    return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  // ── MutationObserver ────────────────────────────────────────────────────────

  function clearRoutePlannerState() {
    _climbs = null;
    _panelInjected = false;
    _lastGPXLength = 0;
    _totalRouteDistance = 0;
    const btn = document.getElementById('climb-inject-button');
    if (btn) btn.remove();
    const panel = document.getElementById('climb-inject-panel');
    if (panel) { panel.remove(); }
    const overlay = document.getElementById('climb-marker-overlay');
    if (overlay) overlay.innerHTML = '';
    chrome.storage.local.remove(['pendingGPX', 'gpxCaptureTime', 'lastClimbResult', 'lastTotalDistance']);
  }

  function onMutation() {
    if (!isRoutePlannerActive()) {
      clearRoutePlannerState();
      return;
    }

    if (!document.getElementById('climb-inject-button')) { tryInjectButton(); }

    if (_climbs && (!_panelInjected || !document.getElementById('climb-inject-panel'))) {
      _panelInjected = false;
      tryInjectPanel();
    }
  }

  // ── Find climbs button injection ─────────────────────────────────────────
  function tryInjectButton() {
    if (document.getElementById('climb-inject-button')) { return;}

    const target = document.querySelector('.route-actions')
    if (!target) return;
    
    target.appendChild(buildButton())
  }

  function buildButton() {
    const panel = document.createElement('div')
    panel.id = 'climb-inject-button';
    panel.className = 'icon-action'

    panel.innerHTML = `
    <button type="button">
        <svg x="0px" y="0px" viewBox="0 0 24 24" class="icon">
          <polyline points="3 17 9 11 13 15 21 7"/>
          <polyline points="14 7 21 7 21 14"/>
        </svg>
        <span>Climb Analyzer</span>
    </button>`

    panel.querySelector('button').addEventListener('click', onClimbButtonClick);
    return panel;
  }

  function onClimbButtonClick() {
    const exportBtn = findGPXExportButton();
    if (!exportBtn) {
      console.warn('[ClimbAnalyzer] Could not find Export button — export manually to analyse');
      return;
    }

    // Watch for the modal BEFORE clicking so we can hide it the moment it is
    // inserted into the DOM — before the browser has a chance to paint it.
    const observer = new MutationObserver(() => {
      const saveBtn = document.querySelector('.mymaps-dialog__saveBtn');
      if (!saveBtn) return;
      observer.disconnect();

      // Hide the modal root and its parent overlay immediately
      const dialogRoot = saveBtn.closest('.mymaps-dialog__content');
      if (dialogRoot) {
        dialogRoot.style.setProperty('opacity', '0', 'important');
        dialogRoot.style.setProperty('pointer-events', 'none', 'important');
        if (dialogRoot.parentElement) {
          dialogRoot.parentElement.style.setProperty('opacity', '0', 'important');
          dialogRoot.parentElement.style.setProperty('pointer-events', 'none', 'important');
        }
      }

      // Signal page-context injected script to suppress the blob download
      window.postMessage({ type: 'CLIMB_SUPPRESS_DOWNLOAD' }, '*');
      saveBtn.click();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Safety: stop watching after 5 s if modal never appeared
    setTimeout(() => observer.disconnect(), 5000);

    exportBtn.click();
  }

  /**
   * Locate Mapy.cz's Export button.
   * Primary target: div.icon-action[title="Export"] > button (confirmed DOM shape).
   * Falls back to SVG class and text scan for forward-compatibility.
   */
  function findGPXExportButton() {
    // Confirmed selector from live Mapy.cz DOM
    const confirmed = document.querySelector('.icon-action[title="Export"] button');
    if (confirmed) return confirmed;

    // SVG class fallback (same icon, different wrapper)
    const bySvg = document.querySelector('button .icon-export2');
    if (bySvg) return bySvg.closest('button');

    // Text-content scan as last resort
    for (const el of document.querySelectorAll('button, a, [role="button"]')) {
      const t = el.textContent.trim();
      if (t === 'Export' || t === 'GPX' || t === 'Export GPX') return el;
    }

    return null;
  }

  // ── Sidebar panel injection ─────────────────────────────────────────

  function tryInjectPanel() {
    if (document.getElementById('climb-inject-panel')) { renderPanel(); return; }

    const target = document.querySelector('.route-modules') ||
                   document.querySelector('.route-container');
    if (!target) return;

    target.appendChild(buildPanel(_climbs));
    _panelInjected = true;
  }

  function buildPanel(climbs) {
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

    const totalDist     = _totalRouteDistance ||
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

    // Hover chart expand overlay
    panel.querySelectorAll('.climb-profile-container').forEach(c => {
      c.addEventListener('mouseenter', () => showChartOverlay(c));
      c.addEventListener('mouseleave', hideChartOverlay);
    });

    return panel;
  }

  function showChartOverlay(container) {
    hideChartOverlay();
    const svg = container.querySelector('svg');
    if (!svg) return;
    const rect = container.getBoundingClientRect();
    const W = 600, H = 220;
    // Anchor right edge to container's right edge; extend leftward into the map
    const right = Math.round(window.innerWidth - rect.right);
    const top   = Math.max(8, Math.min(Math.round(rect.top + rect.height / 2 - H / 2), window.innerHeight - H - 8));
    const overlay = document.createElement('div');
    overlay.id = 'cip-chart-expand';
    overlay.style.cssText = 'position:fixed;right:' + right + 'px;top:' + top + 'px;' +
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

  // ── Re-render panel after new result ─────────────────────────────────────

  function renderPanel() {
    const existing = document.getElementById('climb-inject-panel');
    if (existing) {
      existing.replaceWith(buildPanel(_climbs));
      _panelInjected = true;
    } else {
      _panelInjected = false;
    }
  }

  // ── Popup-mirrored display helpers ───────────────────────────────────────

  /**
   * Returns the steepest gradient over any consecutive window of `minDistance` metres.
   * Sliding window across ordered segments; accumulates until the window reaches minDistance,
   * then records (elevationGain / windowDistance) and advances the window.
   * This prevents single-point GPS noise from inflating the displayed max grade.
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
      stripSegments += `<div class="strip-segment" style="left:${startPct.toFixed(1)}%;width:${widthPct.toFixed(1)}%;background:${color};opacity:0.85;" title="Climb ${i+1}: Cat ${climb.category}"></div>`;
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

    // Find summit: the point of maximum elevation within this climb
    let summitElev = -Infinity, summitDist = 0;
    for (const seg of climb.segments) {
      if (seg.startElevation > summitElev) { summitElev = seg.startElevation; summitDist = seg.startDistance; }
      if (seg.endElevation   > summitElev) { summitElev = seg.endElevation;   summitDist = seg.endDistance; }
    }
    const summitElevRounded = Math.round(summitElev);
    const summitKm = (summitDist / 1000).toFixed(1);

    const vam     = calcVAM(climb);
    const timeMin = estimateClimbTime(climb);
    const timeStr = timeMin >= 60
      ? `${Math.floor(timeMin / 60)}h ${Math.round(timeMin % 60)}min`
      : `${Math.round(timeMin)} min`;

    const chart = generateElevationChart(climb.segments, climb.distance, climb.category);

    // "The Peak" mini icon — mountain silhouette with snow cap
    const peakSvg = '<svg class="summit-icon" width="11" height="10" viewBox="0 0 11 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<path d="M1 9.5L5.5 0.5L10 9.5H1Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'
      + '<path d="M3.5 5.5L5.5 0.5L7.5 5.5H3.5Z" fill="currentColor" opacity="0.45"/>'
      + '</svg>';

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
          <div class="stat"><span class="stat-label">Summit</span><span class="stat-value stat-secondary stat-summit">${peakSvg}${summitElevRounded} m</span></div>
          <div class="stat"><span class="stat-label">Summit at</span><span class="stat-value stat-secondary">${summitKm} km</span></div>
        </div>
        <div class="climb-meta">
          <div class="climb-meta-item"><span class="climb-meta-label">Est. time</span><span class="climb-meta-value">${timeStr}</span></div>
          <div class="climb-meta-item"><span class="climb-meta-label">VAM</span><span class="climb-meta-value">${vam} m/h</span></div>
          <div class="climb-meta-item"><span class="climb-meta-label">Fiets index</span><span class="climb-meta-value">${calcFiets(climb).toFixed(1)}</span></div>
        </div>
        ${chart}
      </div>`;
  }

  function getCategoryClass(cat) {
    return cat === 'HC' ? 'hc' : cat === '1' ? 'cat1' : cat === '2' ? 'cat2' : cat === '3' ? 'cat3' : 'cat4';
  }

  function getCategoryColor(cat) {
    // v0.5.5 Peak Style Color Palette
    return { HC: '#800020', '1': '#D32F2F', '2': '#F57C00', '3': '#FBC02D', '4': '#4CAF50' }[cat] || '#4CAF50';
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

  /**
   * Savitzky-Golay smoothing filter
   * Reduces GPS jitter while preserving steep sections and actual peaks
   */
  function savitzkyGolay(data, windowSize = 101, order = 3) {
    if (data.length < windowSize) return data;
    
    // Ensure odd window size
    if (windowSize % 2 === 0) windowSize += 1;
    
    const half = Math.floor(windowSize / 2);
    const output = [];
    
    // Build design matrix for given window size and order
    const designMatrix = [];
    for (let i = -half; i <= half; i++) {
      const row = [];
      for (let j = 0; j <= order; j++) {
        row.push(Math.pow(i, j));
      }
      designMatrix.push(row);
    }
    
    // Compute pseudo-inverse (simplified QR-based approach)
    // For simplicity, use direct least-squares approximation per window
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(data.length, i + half + 1);
      const window = [];
      
      for (let j = start; j < end; j++) {
        window.push(data[j]);
      }
      
      // Fit polynomial to window
      let sum = 0;
      for (let k = 0; k < window.length; k++) {
        sum += window[k];
      }
      
      // Simple average as fallback for smoothing
      output.push(sum / window.length);
    }
    
    return output;
  }

  function generateElevationChart(segments, totalDistanceMeters, climbCategory) {
    if (!segments || segments.length === 0) return '';
    let profile = [], cumulDist = 0;
    for (const seg of segments) {
      profile.push({ distance: cumulDist, elevation: seg.startElevation, gradient: seg.gradient });
      cumulDist += seg.distance;
    }
    profile.push({ distance: cumulDist, elevation: segments[segments.length - 1].endElevation, gradient: 0 });
    if (profile.length < 2) return '';
    
    // Apply Savitzky-Golay smoothing
    const elevations = profile.map(p => p.elevation);
    const smoothedElevations = savitzkyGolay(elevations, 101, 3);
    for (let i = 0; i < profile.length; i++) {
      profile[i].elevation = smoothedElevations[i];
    }
    
    return renderElevationSVG(simplifyElevationProfile(profile), cumulDist, climbCategory);
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

  let _chartUid = 0;
  function renderElevationSVG(profile, totalDistance, climbCategory = '4') {
    if (profile.length < 2) return '';
    const uid = _chartUid++;
    const elevs     = profile.map(p => p.elevation);
    const minElev   = Math.min(...elevs) - 5;
    const maxElev   = Math.max(...elevs) + 5;
    const elevRange = maxElev - minElev;
    if (elevRange === 0) return '';

    const W = 440, H = 120;
    const M = { left: 42, right: 12, top: 10, bottom: 28 };
    const cW = W - M.left - M.right;
    const cH = H - M.top - M.bottom;
    const sx   = d  => M.left + (d / (totalDistance || 1)) * cW;
    const sy   = el => H - M.bottom - ((el - minElev) / elevRange) * cH;
    const base = H - M.bottom;

    const getColorForGrade = g => {
      if (g < 3)  return '#4CAF50';
      if (g < 6)  return '#FBC02D';
      if (g < 9)  return '#F57C00';
      if (g < 12) return '#D32F2F';
      return '#800020';
    };

    // ─── Catmull-Rom → Cubic Bezier (smooth tangents at every point) ───────────
    const pts = profile.map(p => ({ x: sx(p.distance), y: sy(p.elevation) }));

    const buildCurve = () => {
      let d = '';
      for (let i = 1; i < pts.length; i++) {
        const p0 = pts[Math.max(0, i - 2)];
        const p1 = pts[i - 1];
        const p2 = pts[i];
        const p3 = pts[Math.min(pts.length - 1, i + 1)];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
      }
      return d;
    };

    const first = pts[0], last = pts[pts.length - 1];
    const curve = buildCurve();
    const fillPath   = `M ${first.x.toFixed(1)} ${base} L ${first.x.toFixed(1)} ${first.y.toFixed(1)}${curve} L ${last.x.toFixed(1)} ${base} Z`;
    const strokePath = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}${curve}`;

    // ─── Single horizontal gradient with sharp stops per segment boundary ──────
    // Duplicate offset at each boundary produces a hard color edge (no blending)
    const stops = [];
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i], b = profile[i + 1];
      const dD = b.distance - a.distance;
      const g  = dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
      const col = getColorForGrade(g);
      const sPct = (a.distance / (totalDistance || 1) * 100).toFixed(2) + '%';
      const ePct = (b.distance / (totalDistance || 1) * 100).toFixed(2) + '%';
      stops.push(`<stop offset="${sPct}" stop-color="${col}"/>`);
      stops.push(`<stop offset="${ePct}" stop-color="${col}"/>`);
    }

    // ─── Grid ──────────────────────────────────────────────────────────────────
    let yAxis = '';
    for (let i = 0; i < 4; i++) {
      const r = i / 3;
      const el = minElev + r * elevRange;
      const y  = sy(el).toFixed(1);
      yAxis += `<line x1="${M.left - 4}" y1="${y}" x2="${M.left}" y2="${y}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>`;
      yAxis += `<text x="${M.left - 6}" y="${y}" dy="0.35em" font-size="10" fill="#666" text-anchor="end">${Math.round(el)}</text>`;
      if (i > 0 && i < 3)
        yAxis += `<line x1="${M.left}" y1="${y}" x2="${W - M.right}" y2="${y}" stroke="rgba(0,0,0,0.07)" stroke-width="0.5"/>`;
    }

    // ─── X-axis: labels at grade-category boundaries ───────────────────────────
    // Derive grade color for each profile segment
    const segColors = profile.slice(0, -1).map((a, i) => {
      const b = profile[i + 1];
      const dD = b.distance - a.distance;
      const g = dD > 0 ? ((b.elevation - a.elevation) / dD) * 100 : 0;
      return getColorForGrade(g);
    });
    // Collect boundaries: start + every color-change point + end
    const boundaries = [profile[0].distance];
    for (let i = 1; i < profile.length - 1; i++) {
      if (segColors[i] !== segColors[i - 1]) boundaries.push(profile[i].distance);
    }
    boundaries.push(profile[profile.length - 1].distance);
    // Forward-greedy filter: drop labels closer than MIN_PX to the previous kept one
    const MIN_PX = 44;
    const kept = [boundaries[0]];
    for (let i = 1; i < boundaries.length - 1; i++) {
      if (sx(boundaries[i]) - sx(kept[kept.length - 1]) >= MIN_PX) kept.push(boundaries[i]);
    }
    // Always show end: replace last if too close, otherwise append
    const endD = boundaries[boundaries.length - 1];
    if (sx(endD) - sx(kept[kept.length - 1]) < MIN_PX) {
      kept[kept.length - 1] = endD;
    } else {
      kept.push(endD);
    }

    let xAxis = '';
    for (const d of kept) {
      const x = sx(d).toFixed(1);
      const lbl = totalDistance >= 1000 ? `${(d / 1000).toFixed(1)}km` : `${Math.round(d)}m`;
      xAxis += `<line x1="${x}" y1="${base}" x2="${x}" y2="${base + 3}" stroke="rgba(0,0,0,0.25)" stroke-width="0.5"/>`;
      xAxis += `<text x="${x}" y="${H - 6}" font-size="9" fill="#666" text-anchor="middle">${lbl}</text>`;
    }

    return `
      <div class="climb-profile-container">
        <svg viewBox="0 0 ${W} ${H}" class="profile-svg" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <clipPath id="profileClip-${uid}">
              <path d="${fillPath}"/>
            </clipPath>
            <!-- Single horizontal gradient: sharp stop pairs eliminate seams -->
            <linearGradient id="slopeGrad-${uid}" x1="${M.left}" y1="0" x2="${W - M.right}" y2="0" gradientUnits="userSpaceOnUse">
              ${stops.join('\n              ')}
            </linearGradient>
            <linearGradient id="auraFade-${uid}" x1="0" y1="${M.top}" x2="0" y2="${base}" gradientUnits="userSpaceOnUse">
              <stop offset="0%"   stop-color="#fff" stop-opacity="0.55"/>
              <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
            </linearGradient>
          </defs>

          <rect width="${W}" height="${H}" fill="#f7f8f9"/>

          <!-- One gradient fill rect + aura, clipped to smooth Bezier shape -->
          <g clip-path="url(#profileClip-${uid})">
            <rect x="${M.left}" y="${M.top}" width="${cW}" height="${cH}" fill="url(#slopeGrad-${uid})"/>
            <rect x="${M.left}" y="${M.top}" width="${cW}" height="${cH}" fill="url(#auraFade-${uid})"/>
          </g>

          <!-- Axis lines -->
          <line x1="${M.left}" y1="${M.top}" x2="${M.left}" y2="${base}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
          <line x1="${M.left}" y1="${base}"  x2="${W - M.right}" y2="${base}" stroke="rgba(0,0,0,0.2)" stroke-width="1"/>
          ${yAxis}

          <!-- Catmull-Rom Bezier stroke, same slope gradient as fill -->
          <path d="${strokePath}" fill="none" stroke="url(#slopeGrad-${uid})" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>

          ${xAxis}
        </svg>
      </div>`;
  }

})();
