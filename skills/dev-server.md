---
name: Dev Server
description: Manage development servers with automatic port detection and cleanup.
---

# Dev Server Management

Manage development servers with automatic port detection and cleanup.

## Usage

Parse the arguments to determine which action to take:

- `start [port]` - Start the dev server
- `stop [port]` - Stop the dev server
- `status` - Show running dev servers

If no subcommand provided, show status.

---

## State File

Track the active dev server port in a temp file to survive context compaction:
- **File path:** `/tmp/claude-dev-server-{cwd-basename}.port`
- Example: If working in `/Users/cboyd/code/shopify-tools`, file is `/tmp/claude-dev-server-shopify-tools.port`
- Contains just the port number (e.g., `3001`)

---

## start

Start a development server, automatically finding a free port if needed.

**Steps:**

1. Get the requested port from arguments, default to `3000`
2. Check if the port is in use: `lsof -ti:PORT`
3. If in use, increment port by 1 and check again (repeat until free port found, max 10 attempts)
4. Once a free port is found, inform the user which port will be used
5. Detect the package manager/start command:
   - If `bun.lockb` exists: `PORT=XXXX bun dev`
   - Else if `pnpm-lock.yaml` exists: `PORT=XXXX pnpm dev`
   - Else if `yarn.lock` exists: `PORT=XXXX yarn dev`
   - Else: `PORT=XXXX npm run dev`
6. Write the port to the state file: `echo PORT > /tmp/claude-dev-server-{cwd-basename}.port`
7. Start the server in background using `run_in_background: true`
8. Wait 5 seconds, then verify the server is responding: `curl -s -o /dev/null -w "%{http_code}" http://localhost:PORT`
9. Report success with the port number and remind user to run `/dev-server stop` when done

---

## stop

Stop a development server and verify cleanup.

**Steps:**

1. Determine the port:
   - If port provided as argument, use that
   - Else read from state file: `cat /tmp/claude-dev-server-{cwd-basename}.port 2>/dev/null`
   - If no state file, check common ports (3000-3010) and list what's running, then ask which to stop
2. Find and kill the process: `lsof -ti:PORT | xargs kill -9 2>/dev/null`
3. Wait 1 second for cleanup
4. Verify the port is free: `lsof -ti:PORT`
5. If still in use, try `kill -9` again with the specific PID
6. Remove the state file: `rm -f /tmp/claude-dev-server-{cwd-basename}.port`
7. Report success or failure

---

## status

Show what's running on common development ports.

**Steps:**

1. Check if state file exists and show tracked port: `cat /tmp/claude-dev-server-{cwd-basename}.port 2>/dev/null`
2. Check ports 3000-3010 for running processes:
   ```bash
   for port in 3000 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010; do
     pid=$(lsof -ti:$port 2>/dev/null)
     if [ -n "$pid" ]; then
       echo "Port $port: PID $pid"
     fi
   done
   ```
3. If nothing found, report "No dev servers running on ports 3000-3010"
4. Otherwise, list each port with its PID, noting which one is tracked in the state file

---

## Notes

- Always run `stop` when done with browser testing
- The PORT environment variable works with Next.js, Vite, and most other dev servers
- State file is per-project (based on cwd basename) so multiple worktrees can track separately
- If a server won't stop, you may need to manually find the parent process with `ps aux | grep node`
