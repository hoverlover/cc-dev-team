/**
 * Health check endpoint for the broker.
 *
 * Returns agent status, uptime, and mode information.
 * Used by Fly.io Machine health checks and Vercel API readiness checks.
 */

/**
 * Create a health check request handler.
 *
 * @param {object} options
 * @param {function} options.getAgents - Returns array of active agent role names
 * @param {function} options.getUptime - Returns uptime in seconds
 * @param {string}  [options.mode]    - Operating mode ('local' | 'cloud')
 */
export function createHealthHandler({ getAgents, getUptime, mode }) {
  return function handleHealth(_req, res) {
    const body = {
      status: 'healthy',
      agents: getAgents(),
      uptime: getUptime(),
    }
    if (mode) {
      body.mode = mode
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}
