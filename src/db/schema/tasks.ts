import { pgTable, uuid, text, integer, numeric, jsonb, timestamp } from 'drizzle-orm/pg-core'
import { projects } from './projects'
import { tenants } from './tenants'

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('queued'),
  priority: integer('priority'),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  resultSummary: text('result_summary'),
  githubPrUrl: text('github_pr_url'),
  githubIssueUrl: text('github_issue_url'),
  error: text('error'),
  costTokens: jsonb('cost_tokens'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 4 }),
  metadata: jsonb('metadata'),
})
