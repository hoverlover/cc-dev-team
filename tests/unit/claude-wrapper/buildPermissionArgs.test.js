import { describe, it, expect } from 'vitest'
import { buildPermissionArgs } from '../../../tools/lib/buildPermissionArgs.js'

describe('buildPermissionArgs', () => {
  it('returns --permission-mode acceptEdits by default', () => {
    expect(buildPermissionArgs(false)).toEqual(['--permission-mode', 'acceptEdits'])
  })

  it('returns --dangerously-skip-permissions when skipPermissions is true', () => {
    expect(buildPermissionArgs(true)).toEqual(['--dangerously-skip-permissions'])
  })

  it('returns default args for undefined/null/0', () => {
    expect(buildPermissionArgs(undefined)).toEqual(['--permission-mode', 'acceptEdits'])
    expect(buildPermissionArgs(null)).toEqual(['--permission-mode', 'acceptEdits'])
    expect(buildPermissionArgs(0)).toEqual(['--permission-mode', 'acceptEdits'])
  })

  it('never includes both --permission-mode and --dangerously-skip-permissions', () => {
    const skipArgs = buildPermissionArgs(true)
    const defaultArgs = buildPermissionArgs(false)

    // When skipping, should not contain --permission-mode
    expect(skipArgs).not.toContain('--permission-mode')

    // When not skipping, should not contain --dangerously-skip-permissions
    expect(defaultArgs).not.toContain('--dangerously-skip-permissions')
  })
})
