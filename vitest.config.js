import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Use 'forks' pool for native module compatibility (node-pty)
    pool: 'forks',
    // Test file patterns
    include: ['tests/**/*.test.{js,ts}'],
    // Coverage configuration
    coverage: {
      provider: 'v8',
      include: ['tools/**/*.js', 'broker/**/*.js'],
      exclude: ['**/node_modules/**', '**/tests/**']
    }
  }
})
