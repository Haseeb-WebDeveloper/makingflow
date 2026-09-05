import { type NextRequest, NextResponse } from 'next/server'

// Public surface. Form RESPONDENTS are unauthenticated (they fill forms at
// /f/*); only BUILDERS log in. Everything not listed here requires a session.
//
// IMPORTANT: list ONLY paths that have no protected route at the same URL. With
// cacheComponents/PPR, a public path skips this gate and Next can emit the
// route's static shell with a 200 BEFORE a layout's getRequiredUser() redirect
// fires — leaking protected content. (e.g. the dashboard owns /templates, so it
// must NOT be public here. Marketing pages get their own distinct paths.)
const PUBLIC_PATHS = [
  '/', // marketing home (exact match only — see isPublicPath)
  '/terms', // legal: terms of service (marketing, no protected route here)
  '/privacy', // legal: privacy policy (marketing, no protected route here)
  '/docs', // MCP connection docs — advertised as resource_documentation in the
  // discovery document, so it must be readable without an account. No protected
  // route lives at this URL.
  '/sandbox', // dev-only state gallery (no protected route at this URL)
  '/f', // public form-fill runtime: /f/[formId]
  '/invite', // workspace invitation landing: /invite/[token] (handles its own auth)
  '/auth', // login, signup, callback, magic-link, password reset
  '/api/forms', // public submission + conversational turn endpoint (/api/forms/turn)
  '/api/partial', // anonymous save-&-resume drafts (both render modes)
  '/api/track', // anonymous funnel beacons (view/start/complete)
]

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function shouldSkipEntirely(pathname: string): boolean {
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    /\.(png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|woff2?|json|txt|xml|webmanifest)$/.test(
      pathname,
    )
  ) {
    return true
  }
  if (pathname.startsWith('/api/webhooks')) return true
  // The MCP server and its discovery document authenticate themselves, with a
  // bearer token rather than a session cookie. They must SKIP this gate rather
  // than join PUBLIC_PATHS: a public path is still rendered by Next, and under
  // cacheComponents that can emit a static shell with a 200 before a layout's
  // auth redirect fires. Skipping avoids the question entirely — and without
  // this, every bearer request gets a 302 to /auth/login, which an MCP client
  // reports as a baffling HTML response.
  if (pathname.startsWith('/api/mcp')) return true
  if (pathname.startsWith('/.well-known')) return true
  return false
}

/**
 * Cookie-only auth gate — intentionally ZERO network calls.
 *
 * Rule: proxy checks only that a Supabase session cookie EXISTS. Real JWT
 * validation + the DB user lookup happen in getRequiredUser() inside the
 * protected layout. Doing auth work here would cost a network round-trip on
 * every request and defeat streaming/PPR — the #1 Next.js 16 perf footgun.
 */
export function handleProxyAuth(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  if (shouldSkipEntirely(pathname)) return NextResponse.next()
  if (isPublicPath(pathname)) return NextResponse.next()

  const hasSession = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-'))

  if (!hasSession) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}
