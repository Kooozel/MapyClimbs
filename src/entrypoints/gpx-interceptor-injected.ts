/**
 * gpx-interceptor-injected entrypoint — Page-context unlisted script (web_accessible_resource).
 * Intercepts fetch/XHR GPX export requests and captures the SMap instance.
 * Communicates with the content script (interceptor.content.ts) via postMessage.
 *
 * Runs in the page's JavaScript context (not a content script sandbox),
 * so it can patch window.fetch and XMLHttpRequest prototypes.
 */

import { installDownloadSuppressor } from "../injected/download-suppressor";
import { installFetchInterceptor, installXhrInterceptor } from "../injected/gpx-interceptors";
import { installSmapCapture } from "../injected/smap-capture";
import { installMarkerInjectionListener } from "../injected/marker-injection";

export default defineUnlistedScript(() => {
  installDownloadSuppressor();
  installFetchInterceptor();
  installXhrInterceptor();
  installSmapCapture();
  installMarkerInjectionListener();
});
