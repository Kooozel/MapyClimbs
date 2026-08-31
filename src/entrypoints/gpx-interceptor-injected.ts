/**
 * gpx-interceptor-injected entrypoint — Page-context unlisted script (web_accessible_resource).
 * Intercepts fetch/XHR GPX export requests and centres the map on request.
 * Communicates with the content scripts via postMessage.
 *
 * Runs in the page's JavaScript context (not a content script sandbox),
 * so it can patch window.fetch and XMLHttpRequest prototypes.
 */

import { installDownloadSuppressor } from "../injected/download-suppressor";
import { installXhrInterceptor } from "../injected/gpx-interceptors";
import { installMapCenterListener } from "../injected/map-center";

export default defineUnlistedScript(() => {
  installDownloadSuppressor();
  installXhrInterceptor();
  installMapCenterListener();
});
