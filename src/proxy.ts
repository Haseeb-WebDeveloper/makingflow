import { type NextRequest } from 'next/server'
import { handleProxyAuth } from '@/lib/supabase/middleware'

// Next.js 16 renames middleware.ts → proxy.ts (export `proxy`). NEVER create
// a middleware.ts in this project.
export function proxy(request: NextRequest) {
  return handleProxyAuth(request)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
