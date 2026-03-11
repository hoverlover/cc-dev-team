import { pgTable, uuid, text, jsonb, timestamp, unique } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  repoUrl: text('repo_url'),
  repoFullName: text('repo_full_name'),
  description: text('description'),
  status: text('status').default('active'),
  flyVolumeId: text('fly_volume_id'),
  providerConfig: jsonb('provider_config').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => [
  unique('projects_tenant_id_name_key').on(table.tenantId, table.name),
])
