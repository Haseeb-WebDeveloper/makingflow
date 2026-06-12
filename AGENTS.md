<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# MakingFlow — project-specific rules

MakingFlow is an **AI form builder SaaS**: Tally-style document editor + Deformity-style adaptive AI, multi-tenant. See `doc/PRODUCT.md` for the product spec (what to build and what NOT to build).

- Stack: Next.js 16, Supabase, Drizzle ORM, Tailwind, shadcn/ui (`radix-maia` style, `hugeicons`)
- Database schema is at `src/lib/db/schema.ts`; Drizzle client at `src/lib/db/index.ts`
- Server Actions live in `src/lib/actions/` — never inline them
- Auth helper is `getRequiredUser()` in `src/lib/auth/session.ts` (to be created)
- AI prompt/flow logic lives in `src/lib/ai/`
- `cacheComponents: true` is enabled — use the `"use cache"` directive, NOT `unstable_cache`
- `proxy.ts` replaces `middleware.ts` — never create `middleware.ts`
- `params` and `searchParams` are always Promises — always await them
- This is a **multi-tenant SaaS**: every query must be scoped to the caller's workspace; never leak data across tenants
- AI must degrade gracefully — a form must still render, submit, and store data if the AI layer is unavailable

# Documentation (read before building any feature):
- `doc/PRODUCT.md` — product source of truth: what MakingFlow is, features, use cases, non-goals
- `CODING_GUIDE.md` — Next.js 16 patterns, auth, caching, server actions, common bugs
