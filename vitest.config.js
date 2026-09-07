import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: [
        'src/content/chart.ts',
        'src/map-geometry.ts',
        'src/content/climb-card.ts',
      ],
      reporter: ['text', 'html'],
    },
  },
});
