import { createBrowserClient } from '@supabase/ssr'

/** Browser Supabase client — for Client Components (auth state, OAuth redirects). */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
