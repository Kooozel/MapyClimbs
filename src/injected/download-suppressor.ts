/**
 * injected/download-suppressor.ts
 * Intercepts programmatic anchor clicks to suppress blob downloads triggered
 * by the GPX export flow when the extension has already captured the data.
 */

let _suppressNextDownload = false;

export function installDownloadSuppressor(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window || event.origin !== location.origin) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = event.data as any;
    if (data?.type === "CLIMB_SUPPRESS_DOWNLOAD") {
      _suppressNextDownload = true;
    }
  });

  const _origAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    if (_suppressNextDownload && this.download && this.href.startsWith("blob:")) {
      _suppressNextDownload = false;
      return;
    }
    return _origAnchorClick.call(this);
  };
}
