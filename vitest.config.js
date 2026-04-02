import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['extension/climb-engine.js'],
      reporter: ['text', 'html'],
      thresholds: {
        branches: 80,
        lines:    80,
      },
    },
  },
});
