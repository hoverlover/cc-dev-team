import { pgTable, uuid, text, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { projects } from './projects'
import { tenants } from './tenants'
import { tasks } from './tasks'

export const machines = pgTable('machines', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  flyMachineId: text('fly_machine_id'),
  flyAppName: text('fly_app_name'),
  status: text('status').default('starting'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  agents: jsonb('agents'),
  costSummary: jsonb('cost_summary'),
})
