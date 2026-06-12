# Next.js 16 — Complete AI Coding Guide (MakingFlow)

> Stack: Next.js 16.2+ · Supabase · Drizzle · Tailwind · shadcn/ui
> This file is your source of truth. Read it before writing any Next.js code.
> AI models were trained on older Next.js — this corrects the outdated patterns they default to.
> Code examples use MakingFlow's domain (workspaces, forms, fields, submissions) to illustrate the framework patterns.

---

## BEFORE ANYTHING ELSE — THE AGENTS.MD SETUP

Next.js ships version-matched documentation inside the `next` package. The `AGENTS.md` at the project root directs agents to these bundled docs (`node_modules/next/dist/docs/`) instead of training data — they always match the installed version. `CLAUDE.md` just re-exports it via `@AGENTS.md`. Both already exist in this repo.

---

## 0. THE MENTAL MODEL

Two sentences. If you remember nothing else, remember these:

> **Everything runs at request time by default. You explicitly opt IN to caching with `"use cache"`.**

This is the opposite of Next.js 13/14, which cached everything by default and caused stale-data bugs everywhere. Next.js 15 started reversing this; Next.js 16 completed it. If AI writes `fetch({ cache: 'force-cache' })` or `unstable_cache()` — it's using old patterns. The correct v16 pattern is the `"use cache"` directive.

---

## 1. PROJECT SETUP

### next.config.ts

```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Enables "use cache" directive + PPR — required for this guide
  cacheComponents: true,

  // React Compiler — auto-memoization
  reactCompiler: true,

  // Forward browser errors to terminal — critical for AI debugging (16.2+).
  // AI agents can't see the browser console; this makes errors visible.
  logging: {
    browserToTerminal: 'error', // 'warn' | true (all) | false (disable)
  },
}

export default nextConfig
```

### Folder Structure

```
src/
├── app/
│   ├── page.tsx              # Marketing homepage — public, no auth
│   ├── (marketing)/          # Public pages: pricing, about, templates
│   ├── f/[formId]/           # PUBLIC form-fill runtime (no login) — classic + conversational
│   ├── (dashboard)/          # Builder app — auth required
│   │   ├── layout.tsx        # Auth guard: getRequiredUser()
│   │   ├── forms/            # form list + builder
│   │   ├── submissions/      # submissions inbox + detail
│   │   ├── analytics/        # built-in analytics
│   │   └── settings/         # workspace, team, billing
│   ├── auth/                 # login + signup + Supabase callback
│   └── api/                  # webhooks/* (Stripe, integrations), form submit, ai stream
├── lib/
│   ├── db/
│   │   ├── index.ts          # Drizzle client
│   │   └── schema.ts         # Schema (workspaces, forms, fields, submissions, members)
│   ├── supabase/
│   │   ├── server.ts         # Server-side client
│   │   ├── client.ts         # Browser client
│   │   └── middleware.ts     # handleProxyAuth() — called by proxy.ts
│   ├── auth/
│   │   └── session.ts        # getRequiredUser(), getOptionalUser(), getRequiredWorkspace()
│   ├── actions/              # ALL Server Actions live here — never inline them
│   ├── ai/                   # form generation, adaptive-flow + plain-English-logic prompts
│   ├── data/                 # cached read functions
│   ├── config/  constants/  validations/
├── components/
│   ├── ui/                   # shadcn — never edit these
│   ├── builder/              # the document-style editor
│   ├── forms/                # respondent runtime (classic + conversational)
│   └── dashboard/            # app chrome (sidebar, nav)
└── proxy.ts                  # Auth + routing — NOT middleware.ts

# NOTE: form RESPONDENTS are unauthenticated — they fill forms at /f/[formId]
# via public/shared links. Only BUILDERS (workspace members) log in.
```

### Multi-tenancy rule

MakingFlow is a multi-tenant SaaS. **Every** workspace-scoped query must filter by the caller's `workspaceId`. Never trust a `workspaceId` from the client without verifying the user is a member. Treat cross-tenant leakage as a P0 security bug.

---

## 2. proxy.ts — REPLACES MIDDLEWARE.TS

`middleware.ts` is deprecated in Next.js 16. Rename it to `proxy.ts` and rename the export to `proxy`.

**Rule: proxy.ts only checks if a session cookie EXISTS. No DB calls. No JWT verification. Keep it under 20ms.**

```ts
// src/proxy.ts
import { type NextRequest, NextResponse } from 'next/server'

// Public surface. Respondents fill forms at /f/* without auth. Everything
// NOT public requires a session cookie; layouts do the real validation.
const PUBLIC_PATHS = [
  '/',
  '/pricing',
  '/templates',
  '/f', // public form-fill runtime
  '/auth/login',
  '/auth/signup',
  '/auth/callback',
  '/api/forms', // public submission endpoint
]

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Static assets — always allow
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(png|jpg|svg|ico|css|js|woff2?)$/)
  )
    return NextResponse.next()

  // Webhooks — always allow (no session cookie)
  if (pathname.startsWith('/api/webhooks')) return NextResponse.next()

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
  if (isPublic) return NextResponse.next()

  // Protected — presence of any Supabase cookie is enough here. Layouts do
  // the real JWT validation + membership check via getRequiredUser().
  const hasSession = request.cookies.getAll().some((c) => c.name.startsWith('sb-'))
  if (!hasSession) {
    const url = new URL('/auth/login', request.url)
    url.searchParams.set('redirectTo', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

---

## 3. AUTHENTICATION

### Supabase Server Client

```ts
// src/lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  // cookies() is async in Next.js 16 — always await it
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
            // Called from a Server Component — proxy.ts handles redirect
          }
        },
      },
    },
  )
}
```

### getRequiredUser / getRequiredWorkspace — the auth functions you need

```ts
// src/lib/auth/session.ts
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users, workspaceMembers } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

// Use in layouts/pages/actions. Redirects on failure — never returns null.
export async function getRequiredUser() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) redirect('/auth/login')

  const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
  if (!dbUser) redirect('/auth/login')
  return dbUser
}

// Workspace-scoped guard: verifies the user is a member, returns role.
// This is the membership check that prevents cross-tenant access.
export async function getRequiredWorkspace(workspaceId: string) {
  const user = await getRequiredUser()
  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .limit(1)

  if (!membership) redirect('/') // not a member — never reveal the workspace exists
  return { user, workspaceId, role: membership.role } // role: 'owner' | 'member'
}

// For public pages that show different UI for logged-in users
export async function getOptionalUser() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return null
    const [dbUser] = await db.select().from(users).where(eq(users.id, user.id)).limit(1)
    return dbUser ?? null
  } catch {
    return null
  }
}
```

### Route Group Auth Pattern

```tsx
// src/app/(dashboard)/layout.tsx — one auth check gates the whole app
import { getRequiredUser } from '@/lib/auth/session'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getRequiredUser() // redirects if not logged in
  return (
    <div className="flex h-screen">
      <Sidebar user={user} />
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  )
}
```

---

## 4. CACHING — COMPLETE GUIDE

### The rules in one place

```
cacheComponents: true means:
  ✓ Everything is dynamic by default (runs every request)
  ✓ Add "use cache" to opt INTO caching
  ✓ Never cache anything that touches cookies/headers/session
  ✓ Cached functions CANNOT call cookies(), headers(), searchParams directly
  ✓ Pass user/workspace-specific values as arguments to cached functions
```

### "use cache" constraints — things AI gets wrong

```ts
// ❌ WRONG — cached functions cannot read cookies/headers directly
async function getWorkspaceData() {
  'use cache'
  const cookieStore = await cookies() // ERROR: not allowed inside cached scope
  ...
}

// ✅ CORRECT — read session OUTSIDE, pass the id IN as an argument
export default async function Page() {
  const user = await getRequiredUser()        // reads cookies — NOT cached
  const data = await getWorkspaceData(user.id) // pass id — cached safely
  return <View data={data} />
}

async function getWorkspaceData(workspaceId: string) {
  'use cache'
  cacheLife('minutes')
  cacheTag(`workspace-${workspaceId}`) // per-workspace cache key
  return db.select().from(...)...
}
```

### Cache profiles reference

| Profile     | Use for             |
| ----------- | ------------------- |
| `'seconds'` | Real-time data      |
| `'minutes'` | Fast-changing       |
| `'hours'`   | Moderately updated  |
| `'days'`    | Slowly updated      |
| `'max'`     | Almost static       |

### What to cache vs. never cache (MakingFlow)

```ts
// src/lib/data/forms.ts
import { cacheLife, cacheTag } from 'next/cache'

// ✅ Published form definition for the public runtime — same for all
// respondents, safe to cache aggressively.
export async function getPublishedForm(formId: string) {
  'use cache'
  cacheLife('hours')
  cacheTag(`form-${formId}`)
  return db.select().from(forms).where(eq(forms.id, formId)).limit(1)
}

// ❌ NEVER cache live submission counts / analytics — must be fresh.
export async function getSubmissionCount(formId: string) {
  return db
    .select({ count: sql<number>`count(*)` })
    .from(submissions)
    .where(eq(submissions.formId, formId))
}
```

### Cache invalidation after mutations

```ts
// updateTag() — user-initiated mutations (read-your-writes)
export async function publishForm(formId: string) {
  'use server'
  const { workspaceId } = await getRequiredWorkspace(/* ...resolve from form... */ '')
  await db.update(forms).set({ status: 'published' }).where(eq(forms.id, formId))
  updateTag(`form-${formId}`) // respondents see the new version immediately
}

// revalidateTag() — background jobs, webhooks, admin actions (SWR ok)
```

**Rule: `updateTag` = user-initiated mutations. `revalidateTag` = background jobs, webhooks, admin.**

---

## 5. THE ACTIVITY COMPONENT BUG — READ THIS

With `cacheComponents: true`, Next.js wraps routes with React's `<Activity>`. Navigating away **hides** the previous page (`display:none`) instead of unmounting it; navigating back shows it with state intact. Components do **not** remount.

This breaks:
- Multi-step flows showing stale "success" state on return
- Forms with the same field names appearing twice in the DOM (Playwright strict-mode fails)
- Dropdowns/dialogs keeping stale open state
- State set from a URL param persisting after the param is gone

**Fixes:**

```tsx
// Fix 1 — reset state on pathname change
'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
function Flow() {
  const pathname = usePathname()
  const [step, setStep] = useState<'form' | 'done'>('form')
  useEffect(() => setStep('form'), [pathname])
  // ...
}

// Fix 2 — key prop forces a full remount (use for forms / multi-step)
function PageWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return <div key={pathname}>{children}</div>
}

// Fix 3 — drive important UI state from the URL (survives remounts)
```

Which fix: forms/multi-step → Fix 2 · URL-derived modal state → Fix 1 or 3 · simple dropdowns → Fix 1 · login/signup → Fix 2 + unique field `id`s per page. This matters for the **form builder preview and the respondent runtime** especially.

---

## 6. SERVER VS CLIENT COMPONENTS

**One question: "Does it need to run in the browser?"**

- `onClick`/`onChange`/event handlers, `useState`/`useEffect`, browser APIs, Supabase Realtime → **Client**
- Fetches from DB, reads cookies/session, just displays data → **Server**

Push `'use client'` as low as possible — keep pages as Server Components and isolate interactive parts (the editor canvas, the conversational runtime) into leaf Client Components.

---

## 7. SERVER ACTIONS — THE CORRECT PATTERN

All Server Actions go in `src/lib/actions/`. The file-level `'use server'` makes every export a Server Action.

```ts
// src/lib/actions/forms.ts
'use server'

import { z } from 'zod'
import { db } from '@/lib/db'
import { getRequiredWorkspace } from '@/lib/auth/session'
import { updateTag } from 'next/cache'

const RenameSchema = z.object({ title: z.string().min(1).max(200) })

type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string }

export async function renameForm(
  formId: string,
  formData: FormData,
): Promise<ActionResult> {
  // 1. Resolve the form's workspace, 2. auth + membership in one step
  const [form] = await db.select().from(forms).where(eq(forms.id, formId)).limit(1)
  if (!form) return { success: false, error: 'Form not found' }
  const { role } = await getRequiredWorkspace(form.workspaceId) // membership check

  // 3. Validate input — never trust the client
  const parsed = RenameSchema.safeParse({ title: formData.get('title') })
  if (!parsed.success) return { success: false, error: 'Invalid title' }

  // 4. Authorization — does this role allow it?
  if (role !== 'owner' && role !== 'member')
    return { success: false, error: 'Not authorized' }

  // 5. Mutate
  await db.update(forms).set({ title: parsed.data.title }).where(eq(forms.id, formId))

  // 6. Invalidate exactly what changed
  updateTag(`form-${formId}`)
  updateTag(`workspace-forms-${form.workspaceId}`)
  return { success: true }
}
```

### redirect() inside Server Actions — the try/catch trap

```ts
// ❌ redirect() throws internally; try/catch swallows it
// ✅ call redirect() OUTSIDE try/catch
export async function loginAction(formData: FormData) {
  'use server'
  let destination: string | null = null
  try {
    await signIn(formData)
    destination = '/forms'
  } catch {
    return { error: 'Login failed' }
  }
  if (destination) redirect(destination) // outside try/catch — works
}
```

---

## 8. DATA FETCHING

**Always parallel, never sequential:**

```tsx
const [forms, members, usage] = await Promise.all([
  getForms(workspaceId),
  getMembers(workspaceId),
  getUsage(workspaceId),
])
```

**Stream independent sections with `<Suspense>`** so a slow analytics query doesn't block the form list.

**Route Handlers (`route.ts`) only for:** webhooks, the public form-submit endpoint, AI streaming responses, file/signed-URL generation. Never create a route handler just to fetch data for your own page — query the DB directly in a Server Component.

---

## 9. ASYNC PARAMS / SEARCHPARAMS — ALWAYS AWAIT

```tsx
// ✅ Server Component
export default async function FormPage({
  params,
}: {
  params: Promise<{ formId: string }>
}) {
  const { formId } = await params
  const form = await getPublishedForm(formId)
  return <FormRuntime form={form} />
}

// ✅ Client Component — React.use()
'use client'
import { use } from 'react'
export default function Page({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = use(params)
  return <div>{formId}</div>
}
```

---

## 10. ASYNC COOKIES / HEADERS

```ts
const cookieStore = await cookies()
const token = cookieStore.get('token')
const headersList = await headers()
const ua = headersList.get('user-agent')
```

---

## 11. ENV VARS AT RUNTIME

```ts
import { connection } from 'next/server'
export default async function Page() {
  await connection() // marks the page dynamic so process.env isn't inlined at build
  const flag = process.env.ENABLE_FEATURE_X
  return <div>{flag}</div>
}
```

---

## 12. REAL-TIME WITH SUPABASE

Always client-side; never in a Server Component. Server provides initial data, a Client Component subscribes on top and cleans up on unmount. Useful for the **submissions inbox** (new responses streaming in live).

```tsx
'use client'
useEffect(() => {
  const supabase = createClient()
  const channel = supabase
    .channel(`submissions-${formId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: `form_id=eq.${formId}` },
      (payload) => setRows((prev) => [payload.new as Submission, ...prev]))
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}, [formId])
```

---

## 13. LOADING.TSX / ERROR.TSX

- `loading.tsx` — shown while the page's async Server Component streams in (whole page slow)
- `<Suspense>` — for individual slow sections within a page
- `error.tsx` — catches uncaught segment errors; **must be a Client Component**

---

## 14. PERFORMANCE CHECKLIST

**Rendering** — Server Component unless it needs the browser · `'use client'` at the leaf · slow sections in `<Suspense>` · multiple DB calls via `Promise.all()`.
**Caching** — cacheable reads have `"use cache"` + `cacheLife()` + `cacheTag()` · no `cookies()`/`headers()` inside cached scope · per-workspace/per-form cache tags · submission counts/analytics NOT cached · actions call `updateTag()` for every tag they touch.
**Auth & tenancy** — route-group layout calls `getRequiredUser()` · actions start with auth + membership · every workspace query filtered by `workspaceId` · public form runtime never exposes draft/unpublished forms.
**Activity bug** — forms/multi-step use `key={pathname}` or `useEffect` reset · auth forms have unique field IDs.
**Async APIs** — `params`/`searchParams` typed `Promise<>` and awaited · `cookies()`/`headers()` awaited.

---

## 15. WHAT AI GETS WRONG — QUICK REFERENCE

| AI writes this                            | What's wrong                | Use this instead                            |
| ----------------------------------------- | --------------------------- | ------------------------------------------- |
| `middleware.ts`                           | Deprecated in v16           | `proxy.ts` with `export function proxy()`   |
| `export default function middleware()`    | Wrong export name           | `export function proxy()`                   |
| `unstable_cache(fn, keys, opts)`          | Old pattern                 | `"use cache"` directive                     |
| `fetch(url, { cache: 'force-cache' })`    | Old caching model           | `"use cache"` directive                     |
| `export const revalidate = 60`            | Old route-segment config    | `"use cache"` + `cacheLife()`               |
| `export const dynamic = 'force-dynamic'`  | Old opt-out                 | Remove it — dynamic is the v16 default      |
| `experimental: { ppr: true }`             | Removed in v16              | `cacheComponents: true`                     |
| `params.id` (sync)                        | TypeError in v16            | `const { id } = await params`               |
| `cookies().get('token')` (sync)           | TypeError in v16            | `const c = await cookies(); c.get('token')` |
| `revalidateTag('tag')` in a Server Action | Deprecated form             | `updateTag('tag')`                          |
| `router.refresh()` inside a Server Action | No router on the server     | `updateTag()` / `refresh()` from next/cache |
| `try { redirect('/x') } catch {}`         | Redirect swallowed          | Move `redirect()` outside try/catch         |
| `api/data/route.ts` to fetch own data     | Unnecessary round-trip      | Query the DB directly in a Server Component |
