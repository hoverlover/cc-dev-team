/**
 * Creates a request handler for GET /health.
 *
 * @param {function} getState - Returns current broker state
 * @returns {function} HTTP request handler
 */
export function createHealthEndpoint(getState) {
  return function handleHealth(req, res) {
    const state = getState()
    const statusCode = state.healthy ? 200 : 503

    const body = JSON.stringify({
      status: state.healthy ? 'healthy' : 'unhealthy',
      uptime: process.uptime(),
      mode: 'cloud',
      agents: state.agents.map(a => ({
        role: a.role,
        status: a.status,
        pid: a.pid
      })),
      task: state.currentTask ? {
        id: state.currentTask.id,
        status: state.currentTask.status,
        started_at: state.currentTask.startedAt
      } : null,
      memory: process.memoryUsage()
    })

    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(body)
  }
}
