import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The contracts package ships from dist, which only exists after its own build.
// Aliasing to its source keeps local runs independent of that step.
const contractsSource = fileURLToPath(
  new URL('../sportsbook-contracts/packages/ts/src/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: { 'sportsbook-contracts': contractsSource },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
