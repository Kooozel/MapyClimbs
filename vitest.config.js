import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/climb-engine.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        branches: 80,
        lines:    80,
      },
    },
  },
});
