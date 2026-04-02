/**
 * popup.js — Climb Analyzer info popup
 * Shows last GPX capture status and climb analysis results.
 * v0.5: Adds loading spinner, retry button, and climb statistics.
 */
/* global parseGPX */

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
        chrome.runtime.sendMessage({
          type: 'PROCESS_CLIMBS',
          elevation: parseGPX(data.pendingGPX)
        }, (response) => {
          if (response && response.climbs) {
            updateClimbStats();
          }
        });
      }
    });
  });

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

})();
