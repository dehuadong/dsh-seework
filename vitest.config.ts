import { defineConfig } from 'vitest/config'

/**
 * Host-side tests run in Node; the client tests opt into jsdom with a per-file
 * `@vitest-environment jsdom` docblock. The setup file turns on React's
 * act() environment flag (see src/test-setup.ts).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
    testTimeout: 20_000,
  },
})
