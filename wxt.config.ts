import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  manifest: ({ browser }) => ({
    name: "__MSG_extName__",
    description: "__MSG_extDescription__",
    default_locale: "en",
    minimum_chrome_version: "88",
    permissions: ["storage"],
    host_permissions: [
      "https://mapy.cz/*",
      "https://*.mapy.cz/*",
      "https://mapy.com/*",
      "https://*.mapy.com/*",
    ],
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'",
    },
    manifestVersion: 3,
    action: {
      default_title: "MapyClimbs",
      default_icon: {
        16: "images/icon-16.png",
        48: "images/icon-48.png",
        128: "images/icon-128.png",
      },
    },
    web_accessible_resources: [
      {
        resources: ["gpx-interceptor-injected.js", "images/icon-48.png"],
        matches: [
          "https://mapy.cz/*",
          "https://*.mapy.cz/*",
          "https://mapy.com/*",
          "https://*.mapy.com/*",
        ],
      },
    ],
    icons: {
      16: "images/icon-16.png",
      48: "images/icon-48.png",
      128: "images/icon-128.png",
    },
    browser_specific_settings: browser === 'firefox' ? {
      gecko: {
        id: 'mapyclimbs-sikulaf@gmail.com',
        data_collection_permissions: {
            required: ["none"],
        }
      },
    } : undefined,
  }),
});
