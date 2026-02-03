import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Use 'forks' pool for native module compatibility (node-pty, better-sqlite3)
    pool: 'forks',
    // Test file patterns
    include: ['tests/**/*.test.js'],
    // Coverage configuration
    coverage: {
      provider: 'v8',
      include: ['tools/**/*.js', 'broker/**/*.js'],
      exclude: ['**/node_modules/**', '**/tests/**']
    }
  }
})
