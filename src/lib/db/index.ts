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
    // Keep warm connections alive between sparse requests so we don't pay a cold
    // TLS handshake to a remote DB on the first query of each request. Still well
    // under the pooler's own idle reap.
    idle_timeout: 90, // seconds
    max: 5, // small per-instance ceiling — serverless fans out across instances
    max_lifetime: 60 * 30, // recycle a connection after 30 min
    connect_timeout: 10,
  })

if (process.env.NODE_ENV !== 'production') globalForDb._pgClient = client

export const db = drizzle(client, { schema })
