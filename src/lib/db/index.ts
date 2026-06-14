import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Reuse ONE postgres-js client across hot reloads. Without this, every dev HMR
// recompile re-evaluates this module and opens a fresh connection pool while the
// old ones linger — the pooler then reaps the idle sockets, which surfaces as
// `read ECONNRESET` on the next query. Tuning idle_timeout/max_lifetime also
// recycles connections on our side before the pooler closes them.
const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>
}

const client =
  globalForDb._pgClient ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false, // transaction-mode pooler (Supabase pgbouncer) compatible
    idle_timeout: 20, // close idle conns ourselves (seconds) before the pooler does
    max_lifetime: 60 * 30, // recycle a connection after 30 min
    connect_timeout: 10,
  })

if (process.env.NODE_ENV !== 'production') globalForDb._pgClient = client

export const db = drizzle(client, { schema })
