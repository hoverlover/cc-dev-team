import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'

// We'll test the functions by importing them from the module
// First, let's extract them for testability

describe('parseWorktreeOutput', () => {
  let parseWorktreeOutput

  beforeEach(async () => {
    const mod = await import('../../../broker/lib/worktreeDetection.js')
    parseWorktreeOutput = mod.parseWorktreeOutput
  })

  it('parses standard porcelain output with multiple worktrees', () => {
    const output = `worktree /Users/cboyd/code/cc-dev-team
HEAD abc1234def5678901234567890abcdef12345678
branch refs/heads/main

worktree /Users/cboyd/.cc-dev-team/worktrees/cc-dev-team/cdt-bouncy-badger
HEAD def5678abc1234901234567890abcdef12345678
branch refs/heads/feature/11-hook-message-injection

`
    const result = parseWorktreeOutput(
      output,
      '/Users/cboyd/code/cc-dev-team',
      '/Users/cboyd/code/cc-dev-team'
    )

    expect(result).not.toBeNull()
    expect(result.rootPath).toBe('/Users/cboyd/code/cc-dev-team')
    expect(result.rootName).toBe('cc-dev-team')
    expect(result.isWorktree).toBe(false)
    expect(result.list).toHaveLength(2)

    // Root should be first
    expect(result.list[0].isRoot).toBe(true)
    expect(result.list[0].name).toBe('cc-dev-team')
    expect(result.list[0].branch).toBe('main')
    expect(result.list[0].commit).toBe('abc1234')

    // Worktree second
    expect(result.list[1].isRoot).toBe(false)
    expect(result.list[1].name).toBe('cdt-bouncy-badger')
    expect(result.list[1].branch).toBe('feature/11-hook-message-injection')
    expect(result.list[1].commit).toBe('def5678')
  })

  it('sets isWorktree=true when currentPath is a worktree', () => {
    const output = `worktree /Users/cboyd/code/cc-dev-team
HEAD abc1234def5678901234567890abcdef12345678
branch refs/heads/main

worktree /Users/cboyd/.cc-dev-team/worktrees/cc-dev-team/cdt-bouncy-badger
HEAD def5678abc1234901234567890abcdef12345678
branch refs/heads/feature/11-hook-message-injection

`
    const result = parseWorktreeOutput(
      output,
      '/Users/cboyd/code/cc-dev-team',
      '/Users/cboyd/.cc-dev-team/worktrees/cc-dev-team/cdt-bouncy-badger'
    )

    expect(result.isWorktree).toBe(true)
  })

  it('handles detached HEAD worktrees', () => {
    const output = `worktree /Users/cboyd/code/cc-dev-team
HEAD abc1234def5678901234567890abcdef12345678
branch refs/heads/main

worktree /tmp/detached-worktree
HEAD def5678abc1234901234567890abcdef12345678
detached

`
    const result = parseWorktreeOutput(
      output,
      '/Users/cboyd/code/cc-dev-team',
      '/Users/cboyd/code/cc-dev-team'
    )

    expect(result.list).toHaveLength(2)
    expect(result.list[1].branch).toBe('detached')
  })

  it('sorts root first, then by lastModified descending', () => {
    const output = `worktree /Users/cboyd/code/cc-dev-team
HEAD abc1234def5678901234567890abcdef12345678
branch refs/heads/main

worktree /tmp/old-worktree
HEAD 111111111111111111111111111111111111
branch refs/heads/feature/old

worktree /tmp/new-worktree
HEAD 222222222222222222222222222222222222
branch refs/heads/feature/new

`
    const result = parseWorktreeOutput(
      output,
      '/Users/cboyd/code/cc-dev-team',
      '/Users/cboyd/code/cc-dev-team'
    )

    // Root always first
    expect(result.list[0].isRoot).toBe(true)
  })

  it('handles single worktree (root only)', () => {
    const output = `worktree /Users/cboyd/code/cc-dev-team
HEAD abc1234def5678901234567890abcdef12345678
branch refs/heads/main

`
    const result = parseWorktreeOutput(
      output,
      '/Users/cboyd/code/cc-dev-team',
      '/Users/cboyd/code/cc-dev-team'
    )

    expect(result.list).toHaveLength(1)
    expect(result.list[0].isRoot).toBe(true)
  })

  it('returns short commit hashes (7 chars)', () => {
    const output = `worktree /Users/cboyd/code/cc-dev-team
HEAD abc1234def5678901234567890abcdef12345678
branch refs/heads/main

`
    const result = parseWorktreeOutput(
      output,
      '/Users/cboyd/code/cc-dev-team',
      '/Users/cboyd/code/cc-dev-team'
    )

    expect(result.list[0].commit).toBe('abc1234')
    expect(result.list[0].commit).toHaveLength(7)
  })
})

describe('detectWorktrees', () => {
  let detectWorktrees
  let tempDir

  beforeEach(async () => {
    const mod = await import('../../../broker/lib/worktreeDetection.js')
    detectWorktrees = mod.detectWorktrees
    tempDir = mkdtempSync(join(tmpdir(), 'wt-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns null for directories without .git', () => {
    const result = detectWorktrees(tempDir)
    expect(result).toBeNull()
  })

  it('returns null for git repos without worktrees', () => {
    // Create a .git directory without worktrees subdirectory
    mkdirSync(join(tempDir, '.git'), { recursive: true })
    const result = detectWorktrees(tempDir)
    expect(result).toBeNull()
  })

  it('returns null for git repos with empty .git/worktrees', () => {
    mkdirSync(join(tempDir, '.git', 'worktrees'), { recursive: true })
    const result = detectWorktrees(tempDir)
    expect(result).toBeNull()
  })

  it('returns null for non-existent directories', () => {
    const result = detectWorktrees('/nonexistent/path/that/should/not/exist')
    expect(result).toBeNull()
  })

  it('handles .git file (worktree child) with invalid content gracefully', () => {
    writeFileSync(join(tempDir, '.git'), 'invalid content')
    const result = detectWorktrees(tempDir)
    expect(result).toBeNull()
  })
})
