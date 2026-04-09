/**
 * content/panel-template.ts — HTML template strings for the sidebar panel.
 *
 * Exports: renderEmptyPanel, renderPanelShell
 */

export function renderEmptyPanel(iconUrl: string): string {
  return `
    <div class="cip-header">
      <div class="cip-header-bar">
        <img src="${iconUrl}" width="16" height="16" alt="" aria-hidden="true">
        <span>${chrome.i18n.getMessage("panelTitle")}</span>
      </div>
    </div>
    <p class="cip-empty">${chrome.i18n.getMessage("panelNoClimbs")}</p>`;
}

export function renderPanelShell(iconUrl: string, inner: string): string {
  const layerToggleLabel = chrome.i18n.getMessage("panelToggleMapLayer");
  return `
    <div class="cip-header">
      <button class="cip-header-bar cip-toggle" aria-expanded="true">
        <img src="${iconUrl}" width="16" height="16" alt="" aria-hidden="true">
        <span>${chrome.i18n.getMessage("panelTitle")}</span>
        <svg class="cip-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <button class="cip-layer-toggle" id="cip-layer-toggle" title="${layerToggleLabel}" aria-label="${layerToggleLabel}">
        <svg class="cip-eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        <svg class="cip-eye-off-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      </button>
    </div>
    <div class="cip-body"><div class="cip-inner">${inner}</div></div>`;
}
