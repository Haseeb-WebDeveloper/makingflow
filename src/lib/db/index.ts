import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Single postgres-js connection + Drizzle client. `prepare: false` keeps it
// compatible with transaction-mode poolers (e.g. Supabase pgbouncer).
const client = postgres(process.env.DATABASE_URL!, { prepare: false })

export const db = drizzle(client, { schema })
