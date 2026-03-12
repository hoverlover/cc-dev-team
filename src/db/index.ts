import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

/** Service role connection for machine-to-machine operations (bypasses RLS) */
export function createServiceClient() {
  const client = postgres(process.env.SUPABASE_DB_URL!)
  return drizzle(client, { schema })
}
