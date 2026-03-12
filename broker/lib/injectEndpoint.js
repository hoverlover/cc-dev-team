/**
 * Creates a request handler for POST /api/inject-message.
 *
 * @param {object} opts
 * @param {object} opts.db - SQLite database instance
 * @param {string} opts.machineJwt - Expected JWT for authentication
 * @param {string} opts.sessionId - Current broker session ID
 * @param {function} opts.deliverMessage - Callback to deliver message to agent (role, content)
 * @returns {function} HTTP request handler
 */
export function createInjectEndpoint({ db, machineJwt, sessionId, deliverMessage }) {
  return function handleInject(req, res) {
    // Validate JWT
    const authHeader = req.headers.authorization || req.headers.Authorization
    const token = authHeader?.replace('Bearer ', '')
    if (!token || token !== machineJwt) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid token' }))
      return
    }

    const { to, type, content } = req.body || {}
    if (!to || !type || !content) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Missing required fields: to, type, content' }))
      return
    }

    // Write to SQLite messages table (same schema as local mode)
    const stmt = db.prepare(
      'INSERT INTO messages (session_id, from_agent, to_agent, message_type, content) VALUES (?, ?, ?, ?, ?)'
    )
    const result = stmt.run(sessionId, 'human', to, type, content)

    // Deliver to the target agent via broker
    if (deliverMessage) {
      deliverMessage(to, content)
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, messageId: result.lastInsertRowid }))
  }
}
