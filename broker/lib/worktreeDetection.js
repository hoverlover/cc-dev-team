import { existsSync, statSync, readFileSync, readdirSync } from 'fs'
import { join, basename, resolve } from 'path'
import { execSync } from 'child_process'

/**
 * Parse `git worktree list --porcelain` output into structured data.
 *
 * @param {string} output - Raw porcelain output from git worktree list
 * @param {string} rootPath - Absolute path to the main repo root
 * @param {string} currentPath - Absolute path of the directory being listed
 * @returns {{ rootPath: string, rootName: string, isWorktree: boolean, list: WorktreeItem[] }}
 */
export function parseWorktreeOutput(output, rootPath, currentPath) {
  const blocks = output.trim().split('\n\n')
  const list = blocks.map(block => {
    const lines = block.trim().split('\n')
    const wtPath = lines.find(l => l.startsWith('worktree '))?.slice(9)
    const head = lines.find(l => l.startsWith('HEAD '))?.slice(5)
    const branch = lines.find(l => l.startsWith('branch '))?.slice(7)
    if (!wtPath) return null

    const shortBranch = branch ? branch.replace('refs/heads/', '') : 'detached'
    const isRoot = wtPath === rootPath
    let lastModified
    try { lastModified = statSync(wtPath).mtime.toISOString() } catch { lastModified = null }

    return {
      path: wtPath,
      name: basename(wtPath),
      branch: shortBranch,
      commit: head ? head.slice(0, 7) : '',
      isRoot,
      lastModified
    }
  }).filter(Boolean)

  // Sort: root first, then by lastModified descending
  list.sort((a, b) => {
    if (a.isRoot) return -1
    if (b.isRoot) return 1
    return new Date(b.lastModified) - new Date(a.lastModified)
  })

  return {
    rootPath,
    rootName: basename(rootPath),
    isWorktree: currentPath !== rootPath,
    list
  }
}

/**
 * Detect worktrees for a given directory path.
 * Returns null if the directory is not a git repo or has no worktrees.
 *
 * @param {string} dirPath - Absolute path to the directory to check
 * @returns {null | { rootPath: string, rootName: string, isWorktree: boolean, list: WorktreeItem[] }}
 */
export function detectWorktrees(dirPath) {
  const gitPath = join(dirPath, '.git')
  if (!existsSync(gitPath)) return null

  let gitStat
  try { gitStat = statSync(gitPath) } catch { return null }

  let rootPath

  if (gitStat.isDirectory()) {
    // This is a repo root - check for worktrees
    const worktreesDir = join(gitPath, 'worktrees')
    if (!existsSync(worktreesDir)) return null
    const entries = readdirSync(worktreesDir)
    if (entries.length === 0) return null
    rootPath = dirPath
  } else if (gitStat.isFile()) {
    // This is a worktree - .git file contains "gitdir: /path/to/.git/worktrees/name"
    const content = readFileSync(gitPath, 'utf8').trim()
    const match = content.match(/^gitdir:\s*(.+)$/)
    if (!match) return null
    // Resolve: .git/worktrees/<name> → .git/worktrees → .git → repo root
    const gitDir = resolve(dirPath, match[1])
    rootPath = resolve(gitDir, '..', '..', '..')
  } else {
    return null
  }

  // Run git worktree list from the root
  try {
    const output = execSync('git worktree list --porcelain', {
      cwd: rootPath, encoding: 'utf8', timeout: 5000
    })
    return parseWorktreeOutput(output, rootPath, dirPath)
  } catch {
    return null
  }
}
