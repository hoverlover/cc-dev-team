/**
 * Build CLI permission arguments for Claude Code.
 *
 * When skipPermissions is true, uses --dangerously-skip-permissions
 * (which is mutually exclusive with --permission-mode).
 * Otherwise defaults to --permission-mode acceptEdits.
 *
 * @param {boolean} skipPermissions
 * @returns {string[]} CLI arguments to append
 */
export function buildPermissionArgs(skipPermissions) {
  if (skipPermissions) {
    return ['--dangerously-skip-permissions']
  }
  return ['--permission-mode', 'acceptEdits']
}
