import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { handleSubmitTask } from './tools/submit-task'
import { handleGetTaskStatus } from './tools/get-task-status'
import { handleCheckMessages } from './tools/check-messages'
import { handleReplyToMessage } from './tools/reply-to-message'
import { readProjectOverview } from './resources/project-overview'
import { readProjectActivity } from './resources/project-activity'
import { readProjectTasks } from './resources/project-tasks'
import { McpError } from './errors'

interface AuthContext {
  tenantId: string
}

/**
 * Create the MCP server instance with all tools and resources registered.
 * The tenantId is injected per-request from the auth middleware.
 */
export function createServer(authContext: AuthContext) {
  const server = new McpServer({
    name: 'cc-dev-team',
    version: '1.0.0',
  })

  // --- Tools ---

  server.registerTool('submit_task', {
    title: 'Submit Task',
    description: 'Submit a new development task to a project. The task will be queued and a Fly Machine will be started to process it.',
    inputSchema: {
      project: z.string().describe('Project name'),
      title: z.string().describe('Task title'),
      description: z.string().describe('Task description — what to build or fix'),
      priority: z.enum(['low', 'normal', 'high']).optional().describe('Priority level (default: normal)'),
      provider_config: z.record(z.string(), z.object({
        provider: z.string(),
        model: z.string(),
      })).optional().describe('Optional per-role model overrides'),
    },
  }, async ({ project, title, description, priority, provider_config }) => {
    try {
      const result = await handleSubmitTask({
        tenantId: authContext.tenantId,
        project,
        title,
        description,
        priority,
        provider_config: provider_config as Record<string, { provider: string; model: string }> | undefined,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      if (err instanceof McpError) {
        return { content: [{ type: 'text', text: err.message }], isError: true }
      }
      throw err
    }
  })

  server.registerTool('get_task_status', {
    title: 'Get Task Status',
    description: 'Get the current status of a task including agent activity, blockers, and cost.',
    inputSchema: {
      task_id: z.string().uuid().describe('Task UUID'),
    },
  }, async ({ task_id }) => {
    try {
      const result = await handleGetTaskStatus({
        tenantId: authContext.tenantId,
        task_id,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      if (err instanceof McpError) {
        return { content: [{ type: 'text', text: err.message }], isError: true }
      }
      throw err
    }
  })

  server.registerTool('check_messages', {
    title: 'Check Messages',
    description: 'Check for PM messages (questions, status updates, blockers, completion notices). Note: reading messages marks them as read.',
    inputSchema: {
      project: z.string().optional().describe('Filter by project name'),
      unread_only: z.boolean().optional().describe('Only return unread messages (default: true)'),
    },
  }, async ({ project, unread_only }) => {
    try {
      const result = await handleCheckMessages({
        tenantId: authContext.tenantId,
        project,
        unread_only,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      if (err instanceof McpError) {
        return { content: [{ type: 'text', text: err.message }], isError: true }
      }
      throw err
    }
  })

  server.registerTool('reply_to_message', {
    title: 'Reply to Message',
    description: 'Reply to a PM message that requires a response (e.g., answering a question, approving a proposal).',
    inputSchema: {
      message_id: z.string().uuid().describe('PM outbox message UUID'),
      response: z.string().describe('Your reply'),
    },
  }, async ({ message_id, response }) => {
    try {
      const result = await handleReplyToMessage({
        tenantId: authContext.tenantId,
        message_id,
        response,
      })
      return { content: [{ type: 'text', text: JSON.stringify(result) }] }
    } catch (err) {
      if (err instanceof McpError) {
        return { content: [{ type: 'text', text: err.message }], isError: true }
      }
      throw err
    }
  })

  // --- Resources ---

  server.registerResource(
    'Project Overview',
    new ResourceTemplate('project://{project_id}/overview', { list: undefined }),
    {
      description: 'Project name, repo URL, description, status, active task summary, and provider config.',
    },
    async (uri, { project_id }) => {
      const data = await readProjectOverview(project_id as string, authContext.tenantId)
      return { contents: [{ uri: uri.href, text: JSON.stringify(data), mimeType: 'application/json' }] }
    }
  )

  server.registerResource(
    'Project Activity',
    new ResourceTemplate('project://{project_id}/activity', { list: undefined }),
    {
      description: 'Last 20 events (task submissions, completions, PM messages, status changes).',
    },
    async (uri, { project_id }) => {
      const data = await readProjectActivity(project_id as string, authContext.tenantId)
      return { contents: [{ uri: uri.href, text: JSON.stringify(data), mimeType: 'application/json' }] }
    }
  )

  server.registerResource(
    'Project Tasks',
    new ResourceTemplate('project://{project_id}/tasks', { list: undefined }),
    {
      description: 'All tasks for the project with status, dates, cost, and PR URLs.',
    },
    async (uri, { project_id }) => {
      const data = await readProjectTasks(project_id as string, authContext.tenantId)
      return { contents: [{ uri: uri.href, text: JSON.stringify(data), mimeType: 'application/json' }] }
    }
  )

  return server
}
