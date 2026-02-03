import { describe, it, expect } from 'vitest'
import {
  FILE_PATH_REGEX,
  parseFilePath,
  resolveFilePath,
  findFilePathsInLine
} from '../../../dashboard/lib/filePathMatcher.js'

describe('FILE_PATH_REGEX', () => {
  describe('absolute paths', () => {
    it('matches absolute path without line number', () => {
      const match = '/Users/foo/bar.ts'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('/Users/foo/bar.ts')
    })

    it('matches absolute path with line number', () => {
      const match = '/Users/foo/bar.ts:42'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('/Users/foo/bar.ts')
      expect(match[2]).toBe('42')
    })

    it('matches absolute path with line and column', () => {
      const match = '/Users/foo/bar.ts:42:5'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('/Users/foo/bar.ts')
      expect(match[2]).toBe('42')
      expect(match[3]).toBe('5')
    })

    it('matches paths with dashes and underscores', () => {
      const match = '/Users/foo/my-file_name.test.ts:10'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('/Users/foo/my-file_name.test.ts')
    })
  })

  describe('relative paths', () => {
    it('matches relative path with ./', () => {
      const match = './src/file.ts:42'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('./src/file.ts')
      expect(match[2]).toBe('42')
    })

    it('matches relative path with ../', () => {
      const match = '../lib/utils.js'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('../lib/utils.js')
    })

    it('matches implicit relative path (no prefix)', () => {
      const match = 'src/components/Button.tsx:100'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('src/components/Button.tsx')
      expect(match[2]).toBe('100')
    })
  })

  describe('file extensions', () => {
    it('matches common code extensions', () => {
      const extensions = ['ts', 'tsx', 'js', 'jsx', 'json', 'md', 'css', 'html', 'py', 'go']
      for (const ext of extensions) {
        const match = `file.${ext}`.match(FILE_PATH_REGEX)
        expect(match, `Failed for .${ext}`).not.toBeNull()
      }
    })

    it('matches multi-part extensions like .test.ts', () => {
      const match = 'Button.test.tsx:15'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('Button.test.tsx')
    })

    it('does not match files without extensions', () => {
      const match = 'src/noextension'.match(FILE_PATH_REGEX)
      // Should not match - we require an extension to avoid false positives
      expect(match).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('matches file path in middle of text', () => {
      const text = 'Error in src/index.ts:42:10 - something wrong'
      const match = text.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('src/index.ts')
      expect(match[2]).toBe('42')
      expect(match[3]).toBe('10')
    })

    it('handles paths with numbers in directory names', () => {
      const match = 'test123/file.ts:5'.match(FILE_PATH_REGEX)
      expect(match).not.toBeNull()
      expect(match[1]).toBe('test123/file.ts')
    })
  })
})

describe('parseFilePath', () => {
  it('parses path without line/col', () => {
    const result = parseFilePath('/Users/foo/bar.ts', undefined, undefined)
    expect(result).toEqual({
      path: '/Users/foo/bar.ts',
      line: undefined,
      column: undefined
    })
  })

  it('parses path with line number', () => {
    const result = parseFilePath('/Users/foo/bar.ts', '42', undefined)
    expect(result).toEqual({
      path: '/Users/foo/bar.ts',
      line: 42,
      column: undefined
    })
  })

  it('parses path with line and column', () => {
    const result = parseFilePath('/Users/foo/bar.ts', '42', '5')
    expect(result).toEqual({
      path: '/Users/foo/bar.ts',
      line: 42,
      column: 5
    })
  })
})

describe('resolveFilePath', () => {
  const projectDir = '/Users/test/project'

  it('returns absolute paths unchanged', () => {
    const result = resolveFilePath('/Users/other/file.ts', projectDir)
    expect(result).toBe('/Users/other/file.ts')
  })

  it('resolves relative path with ./', () => {
    const result = resolveFilePath('./src/file.ts', projectDir)
    expect(result).toBe('/Users/test/project/src/file.ts')
  })

  it('resolves implicit relative path', () => {
    const result = resolveFilePath('src/file.ts', projectDir)
    expect(result).toBe('/Users/test/project/src/file.ts')
  })

  it('resolves parent directory paths', () => {
    const result = resolveFilePath('../sibling/file.ts', projectDir)
    expect(result).toBe('/Users/test/sibling/file.ts')
  })

  it('returns relative path unchanged if no projectDir', () => {
    const result = resolveFilePath('./src/file.ts', undefined)
    expect(result).toBe('./src/file.ts')
  })
})

describe('findFilePathsInLine', () => {
  it('finds single file path in line', () => {
    const results = findFilePathsInLine('Error in src/index.ts:42')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      path: 'src/index.ts',
      line: 42,
      startIndex: 9,
      endIndex: 24
    })
  })

  it('finds multiple file paths in line', () => {
    const results = findFilePathsInLine('Import src/a.ts:1 and src/b.ts:2')
    expect(results).toHaveLength(2)
    expect(results[0].path).toBe('src/a.ts')
    expect(results[1].path).toBe('src/b.ts')
  })

  it('returns empty array for line with no paths', () => {
    const results = findFilePathsInLine('Just some regular text')
    expect(results).toHaveLength(0)
  })

  it('correctly captures start and end indices', () => {
    const line = 'abc ./file.ts:10 xyz'
    const results = findFilePathsInLine(line)
    expect(results).toHaveLength(1)
    expect(results[0].startIndex).toBe(4)
    expect(results[0].endIndex).toBe(16)
    expect(line.substring(results[0].startIndex, results[0].endIndex)).toBe('./file.ts:10')
  })
})
