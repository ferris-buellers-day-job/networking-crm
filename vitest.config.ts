import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.ts', 'client/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['server/lib/**/*.ts'],
      exclude: ['server/**/*.test.ts'],
    },
  },
});
