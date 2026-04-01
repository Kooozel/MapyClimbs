/**
 * popup.js — Climb Analyzer info popup
 * Shows last GPX capture status and climb analysis results.
 * v0.5: Adds loading spinner, retry button, and climb statistics.
 */

(function () {
  'use strict';

  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  const spinner = document.getElementById('analysis-spinner');
  const climbStatsSection = document.getElementById('climb-stats');
  const retrySection = document.getElementById('retry-section');
  const retryBtn = document.getElementById('retry-btn');
  const climbCountEl = document.getElementById('climb-count');
  const totalDistanceEl = document.getElementById('total-distance');

  /**
   * Show loading spinner during analysis
   */
  function showSpinner() {
    spinner.style.display = 'flex';
    climbStatsSection.style.display = 'none';
    retrySection.style.display = 'none';
  }

  /**
   * Hide spinner and show results if available
   */
  function hideSpinner() {
    spinner.style.display = 'none';
  }

  /**
   * Update popup UI with climb results
   */
  function updateClimbStats() {
    chrome.storage.local.get(['lastClimbResult', 'lastTotalDistance'], (data) => {
      hideSpinner();

      if (data.lastClimbResult && data.lastClimbResult.length > 0) {
        climbCountEl.textContent = data.lastClimbResult.length;
        const distanceKm = (data.lastTotalDistance / 1000).toFixed(1);
        totalDistanceEl.textContent = distanceKm;
        climbStatsSection.style.display = 'block';
        retrySection.style.display = 'none';
      } else if (data.lastClimbResult !== undefined) {
        climbStatsSection.style.display = 'none';
        retrySection.style.display = 'block'; // Show retry button if no climbs found
      }
    });
  }

  /**
   * Retry analysis of the last GPX
   */
  retryBtn.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.storage.local.get('pendingGPX', (data) => {
      if (data.pendingGPX) {
        showSpinner();
        // Re-trigger climb detection by sending message to background
        chrome.runtime.sendMessage({
          type: 'PROCESS_CLIMBS',
          elevation: parseGPXElevation(data.pendingGPX)
        }, (response) => {
          if (response && response.climbs) {
            updateClimbStats();
          }
        });
      }
    });
  });

  /**
   * Parse GPX to extract elevation data
   * Format: [[distance, elevation, lat, lon], ...]
   */
  function parseGPXElevation(gpxContent) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(gpxContent, 'text/xml');
      const trkpts = doc.querySelectorAll('trkpt');
      const points = [];
      let totalDist = 0;

      let prevLat = null, prevLon = null;

      trkpts.forEach((trkpt, idx) => {
        const lat = parseFloat(trkpt.getAttribute('lat'));
        const lon = parseFloat(trkpt.getAttribute('lon'));
        const eleEl = trkpt.querySelector('ele');
        const ele = eleEl ? parseFloat(eleEl.textContent) : 0;

        if (prevLat !== null && prevLon !== null) {
          // Approximate distance in meters (Haversine)
          const lat1 = (prevLat * Math.PI) / 180;
          const lat2 = (lat * Math.PI) / 180;
          const dlat = lat2 - lat1;
          const dlon = ((lon - prevLon) * Math.PI) / 180;
          const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          totalDist += 6371 * c * 1000; // Earth radius 6371 km
        } else {
          totalDist = 0;
        }

        points.push([totalDist, ele, lat, lon]);
        prevLat = lat;
        prevLon = lon;
      });

      return points;
    } catch (e) {
      console.error('[ClimbAnalyzer] Error parsing GPX:', e);
      return [];
    }
  }

  // Listen for GPX capture events
  const port = chrome.runtime.connect({ name: 'popup' });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'GPX_CAPTURED') {
      showSpinner();
      // Wait a moment for climb detection analysis
      setTimeout(updateClimbStats, 500);
    }
  });

  // Initial page load
  chrome.storage.local.get(['gpxCaptureTime', 'pendingGPX', 'lastClimbResult'], (data) => {
    if (data.lastClimbResult && data.lastClimbResult.length > 0) {
      updateClimbStats();
    } else if (data.pendingGPX && data.gpxCaptureTime) {
      const d = new Date(data.gpxCaptureTime);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
      dot.classList.add('ok');
      text.textContent = 'GPX captured at ' + timeStr + ', ' + dateStr;
      updateClimbStats();
    } else {
      dot.classList.add('none');
      text.textContent = 'No GPX captured yet';
    }
  });

  /**
   * v0.5.5: Hover Scanner
   * Track mouse over climb charts and display real-time grade/distance tooltip
   */
  function initHoverScanner() {
    // Delegate chart hover listeners (dynamic DOM support)
    document.addEventListener('mousemove', (e) => {
      const climbChart = e.target.closest('.climb-chart');
      if (climbChart) {
        const rect = climbChart.getBoundingClientRect();
        const pixelX = e.clientX - rect.left;
        const pixelY = e.clientY - rect.top;

        // Show/update hover line and tooltip
        updateHoverScanner(climbChart, pixelX, pixelY);
      }
    });

    document.addEventListener('mouseleave', (e) => {
      if (e.target.closest('.climb-chart')) {
        clearHoverScanner();
      }
    });
  }

  /**
   * Update hover line position and tooltip content
   */
  function updateHoverScanner(chartEl, pixelX, pixelY) {
    let hoverLine = chartEl.querySelector('.hover-line');
    let tooltip = chartEl.querySelector('.hover-tooltip');

    if (!hoverLine) {
      hoverLine = document.createElement('div');
      hoverLine.className = 'hover-line';
      chartEl.appendChild(hoverLine);
    }

    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'hover-tooltip';
      chartEl.appendChild(tooltip);
    }

    // Position hover line
    hoverLine.style.left = pixelX + 'px';
    hoverLine.style.display = 'block';

    // Get chart metadata
    const grade = (Math.random() * 12).toFixed(1); // TODO: calc from segments
    const distance = (pixelX / chartEl.offsetWidth * 5).toFixed(2); // TODO: calc from totalDist
    const elevation = 1200 + (Math.random() * 100); // TODO: interpolate from segments

    // Update tooltip
    tooltip.innerHTML = `
      <div class="tooltip-row">📍 ${distance} km</div>
      <div class="tooltip-row">📈 ${grade}%</div>
      <div class="tooltip-row">🏔️ ${Math.round(elevation)}m</div>
    `;

    tooltip.style.left = pixelX + 'px';
    tooltip.style.top = pixelY + 'px';
    tooltip.style.display = 'block';
  }

  /**
   * Clear hover line and tooltip
   */
  function clearHoverScanner() {
    document.querySelectorAll('.hover-line').forEach(el => el.remove());
    document.querySelectorAll('.hover-tooltip').forEach(el => el.remove());
  }

  // Initialize hover scanner when charts are added
  setTimeout(initHoverScanner, 500);
})();
