import { pgTable, uuid, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { tasks } from './tasks'
import { tenants } from './tenants'

export const pmOutbox = pgTable('pm_outbox', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  content: text('content').notNull(),
  requiresResponse: boolean('requires_response').default(false),
  response: text('response'),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
})
