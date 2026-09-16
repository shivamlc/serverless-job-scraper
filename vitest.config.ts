import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30_000, // adapter tests drive a real headless browser
    hookTimeout: 30_000,
  },
});
