import { describe, it, expect } from 'vitest'
import { getNextInstanceId } from '../../../broker/lib/getNextInstanceId.js'

describe('getNextInstanceId', () => {
  describe('with Map', () => {
    it('returns 1 when no instances exist', () => {
      const processes = new Map()
      expect(getNextInstanceId(processes, 'engineer')).toBe(1)
    })

    it('returns 2 when engineer-1 exists', () => {
      const processes = new Map([['engineer-1', {}]])
      expect(getNextInstanceId(processes, 'engineer')).toBe(2)
    })

    it('returns next sequential ID', () => {
      const processes = new Map([
        ['engineer-1', {}],
        ['engineer-2', {}]
      ])
      expect(getNextInstanceId(processes, 'engineer')).toBe(3)
    })

    it('fills gaps in sequence', () => {
      const processes = new Map([
        ['engineer-1', {}],
        ['engineer-3', {}]
      ])
      expect(getNextInstanceId(processes, 'engineer')).toBe(2)
    })

    it('fills first gap when multiple gaps exist', () => {
      const processes = new Map([
        ['engineer-1', {}],
        ['engineer-4', {}],
        ['engineer-6', {}]
      ])
      expect(getNextInstanceId(processes, 'engineer')).toBe(2)
    })

    it('ignores other roles', () => {
      const processes = new Map([
        ['pm', {}],
        ['architect', {}],
        ['qa-engineer', {}]
      ])
      expect(getNextInstanceId(processes, 'engineer')).toBe(1)
    })

    it('ignores similar but different role names', () => {
      const processes = new Map([
        ['engineer-1', {}],
        ['senior-engineer-1', {}],  // Different role
        ['engineer-lead', {}]        // Not a numbered instance
      ])
      expect(getNextInstanceId(processes, 'engineer')).toBe(2)
    })

    it('handles mixed roles correctly', () => {
      const processes = new Map([
        ['pm', {}],
        ['engineer-1', {}],
        ['architect', {}],
        ['engineer-2', {}],
        ['qa-engineer', {}]
      ])
      expect(getNextInstanceId(processes, 'engineer')).toBe(3)
    })

    it('handles large IDs', () => {
      const processes = new Map([
        ['engineer-1', {}],
        ['engineer-2', {}],
        ['engineer-3', {}],
        ['engineer-100', {}]  // Gap after 3
      ])
      expect(getNextInstanceId(processes, 'engineer')).toBe(4)
    })

    it('handles non-sequential creation order', () => {
      const processes = new Map([
        ['engineer-5', {}],
        ['engineer-2', {}],
        ['engineer-1', {}]
      ])
      // Gap at 3
      expect(getNextInstanceId(processes, 'engineer')).toBe(3)
    })
  })

  describe('with plain object', () => {
    it('returns 1 when no instances exist', () => {
      const processes = {}
      expect(getNextInstanceId(processes, 'engineer')).toBe(1)
    })

    it('returns 2 when engineer-1 exists', () => {
      const processes = { 'engineer-1': {} }
      expect(getNextInstanceId(processes, 'engineer')).toBe(2)
    })

    it('fills gaps in sequence', () => {
      const processes = {
        'engineer-1': {},
        'engineer-3': {}
      }
      expect(getNextInstanceId(processes, 'engineer')).toBe(2)
    })

    it('handles mixed roles', () => {
      const processes = {
        'pm': {},
        'engineer-1': {},
        'architect': {},
        'engineer-2': {}
      }
      expect(getNextInstanceId(processes, 'engineer')).toBe(3)
    })
  })

  describe('edge cases', () => {
    it('handles empty processes Map', () => {
      expect(getNextInstanceId(new Map(), 'engineer')).toBe(1)
    })

    it('handles empty processes object', () => {
      expect(getNextInstanceId({}, 'engineer')).toBe(1)
    })

    it('works with different base roles', () => {
      const processes = new Map([
        ['designer-1', {}],
        ['designer-3', {}]
      ])
      expect(getNextInstanceId(processes, 'designer')).toBe(2)
    })

    it('handles roles with hyphens in name', () => {
      const processes = new Map([
        ['qa-engineer-1', {}],
        ['qa-engineer-2', {}]
      ])
      expect(getNextInstanceId(processes, 'qa-engineer')).toBe(3)
    })

    it('returns correct ID when only one instance with gap from 1', () => {
      const processes = new Map([['engineer-5', {}]])
      expect(getNextInstanceId(processes, 'engineer')).toBe(1)
    })
  })
})
