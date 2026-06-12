import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Server-side Supabase client. Reads/writes the auth cookies via Next 16's
 * async cookies() store. Use in Server Components, Server Actions, and Route
 * Handlers.
 */
export async function createClient() {
  // cookies() is async in Next.js 16 — always await it.
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a Server Component where cookies are read-only —
            // proxy.ts refreshes the session on the next request instead.
          }
        },
      },
    },
  )
}
