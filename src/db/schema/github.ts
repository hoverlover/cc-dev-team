import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'
import { tenants } from './tenants'

export const githubConnections = pgTable('github_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  githubUserId: text('github_user_id').notNull(),
  githubUsername: text('github_username').notNull(),
  tokenVaultId: uuid('token_vault_id'),
  tokenType: text('token_type').default('oauth'),
  scopes: text('scopes').array(),
  installationId: text('installation_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
})
