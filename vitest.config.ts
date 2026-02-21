import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['src/targets/synthetic-repo/fixtures/**'],
    environment: 'node',
    testTimeout: 60000,
  },
});
