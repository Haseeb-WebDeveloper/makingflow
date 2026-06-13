import { type NextRequest } from 'next/server'
import { handleProxyAuth } from '@/lib/supabase/middleware'
import { rewriteCustomDomain } from '@/lib/domains/proxy'

// Next.js 16 renames middleware.ts → proxy.ts (export `proxy`). NEVER create
// a middleware.ts in this project.
export function proxy(request: NextRequest) {
  // Attached custom domains (team.acme.com) serve forms only — rewrite them to
  // the /sites resolver and skip the dashboard auth gate entirely.
  const custom = rewriteCustomDomain(request)
  if (custom) return custom

  return handleProxyAuth(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
