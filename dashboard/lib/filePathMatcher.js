/**
 * File path detection and parsing utilities for terminal link provider
 */

/**
 * Regex to match file paths with optional line:col
 *
 * Matches:
 * - Absolute: /Users/foo/bar.ts:42:5
 * - Relative: ./src/file.ts:42 or src/file.ts
 * - Extensions: .ts, .js, .md, .json, etc. (1-10 chars)
 * - Line:col: :42 or :42:5 (optional)
 *
 * Groups:
 * 1. Full path (including extension)
 * 2. Line number (optional)
 * 3. Column number (optional)
 */
export const FILE_PATH_REGEX = /((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)*[\w.-]+\.[a-zA-Z]{1,10})(?::(\d+))?(?::(\d+))?/

/**
 * Parse a file path match into structured data
 * @param {string} path - The file path
 * @param {string|undefined} lineStr - Line number as string
 * @param {string|undefined} colStr - Column number as string
 * @returns {{ path: string, line: number|undefined, column: number|undefined }}
 */
export function parseFilePath(path, lineStr, colStr) {
  return {
    path,
    line: lineStr ? parseInt(lineStr, 10) : undefined,
    column: colStr ? parseInt(colStr, 10) : undefined
  }
}

/**
 * Resolve a file path relative to project directory
 * @param {string} filePath - The file path (may be relative)
 * @param {string|undefined} projectDir - The project directory for resolving relative paths
 * @returns {string} - The resolved absolute path
 */
export function resolveFilePath(filePath, projectDir) {
  // Already absolute
  if (filePath.startsWith('/')) {
    return filePath
  }

  // No project dir to resolve against
  if (!projectDir) {
    return filePath
  }

  // Resolve relative path
  if (filePath.startsWith('./')) {
    return `${projectDir}/${filePath.slice(2)}`
  }

  if (filePath.startsWith('../')) {
    // Handle parent directory - split projectDir and go up
    const parts = projectDir.split('/')
    let relativeParts = filePath.split('/')

    while (relativeParts[0] === '..') {
      parts.pop()
      relativeParts = relativeParts.slice(1)
    }

    return [...parts, ...relativeParts].join('/')
  }

  // Implicit relative (no prefix)
  return `${projectDir}/${filePath}`
}

/**
 * Find all file paths in a line of text
 * @param {string} line - The line of text to search
 * @returns {Array<{ path: string, line: number|undefined, column: number|undefined, startIndex: number, endIndex: number }>}
 */
export function findFilePathsInLine(line) {
  const results = []
  const globalRegex = new RegExp(FILE_PATH_REGEX.source, 'g')

  let match
  while ((match = globalRegex.exec(line)) !== null) {
    const fullMatch = match[0]
    const parsed = parseFilePath(match[1], match[2], match[3])

    results.push({
      ...parsed,
      startIndex: match.index,
      endIndex: match.index + fullMatch.length
    })
  }

  return results
}
