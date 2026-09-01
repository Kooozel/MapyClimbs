import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Ignore legacy JS source and build output
  { ignores: ["extension/", "dist/"] },

  // TypeScript source files (all browser/webextension context)
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "warn",
    },
  },

  // Node.js context: the climb-engine CLI. Overrides the browser globals above
  // and allows stdout writes, which are this entrypoint's whole purpose.
  {
    files: ["src/cli/**/*.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-console": "off",
    },
  },

  // Node.js context: WXT config and ESLint config itself
  {
    files: ["wxt.config.ts", "eslint.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  }
);
