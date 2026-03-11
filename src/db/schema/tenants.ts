import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core'

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  authId: uuid('auth_id'),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  githubId: text('github_id').unique(),
  avatarUrl: text('avatar_url'),
  plan: text('plan').default('free'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
})
