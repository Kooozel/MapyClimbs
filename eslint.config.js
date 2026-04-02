import js from "@eslint/js";
import globals from "globals";

const sharedRules = {
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
  "no-undef": "error",
  "no-console": "warn",
  "no-empty": ["error", { allowEmptyCatch: true }],
};

export default [
  js.configs.recommended,
  // Content scripts — loaded as classic <script> tags, share one global scope per page.
  {
    files: ["extension/**/*.js"],
    ignores: ["extension/background.js", "extension/climb-engine.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: sharedRules,
  },
  // Node.js build scripts.
  {
    files: ["build.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: sharedRules,
  },
  // Background service worker and its ES module imports.
  {
    files: ["extension/background.js", "extension/climb-engine.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: sharedRules,
  },
];
