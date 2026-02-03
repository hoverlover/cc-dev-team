/**
 * Get the next available instance ID for a multi-instance role.
 * Finds gaps first (e.g., if 1 and 3 exist, returns 2).
 *
 * @param {Map|Object} processes - Map or object with role names as keys
 * @param {string} baseRole - Base role name (e.g., "engineer")
 * @returns {number} Next available instance ID
 */
export function getNextInstanceId(processes, baseRole) {
  const pattern = new RegExp(`^${baseRole}-(\\d+)$`)
  const usedIds = []

  // Support both Map and plain object
  const keys = processes instanceof Map ? processes.keys() : Object.keys(processes)

  for (const existingRole of keys) {
    const match = existingRole.match(pattern)
    if (match) {
      usedIds.push(parseInt(match[1], 10))
    }
  }

  if (usedIds.length === 0) return 1

  usedIds.sort((a, b) => a - b)

  // Find first gap
  for (let i = 0; i < usedIds.length; i++) {
    if (usedIds[i] !== i + 1) {
      return i + 1
    }
  }

  return usedIds[usedIds.length - 1] + 1
}
