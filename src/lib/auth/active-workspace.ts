/**
 * The active-workspace cookie.
 *
 * Lives in its own module because both the reader (`getSession` in ./session.ts)
 * and the writers (the workspace + team server actions) need it, and a
 * `"use server"` file may only export async functions — so these can't hang off
 * an action module.
 *
 * This cookie is a *preference*, never an authorization input: `getSession`
 * only honours it when it names a workspace the caller is actually a member of,
 * and otherwise falls back to their default. A forged value gets ignored, not
 * trusted.
 */

import type { cookies } from "next/headers"

type CookieStore = Awaited<ReturnType<typeof cookies>>

export const ACTIVE_WORKSPACE_COOKIE = "mf_ws"

export function setActiveWorkspaceCookie(store: CookieStore, id: string) {
  store.set(ACTIVE_WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })
}

/** Drop the preference so the caller falls back to their default workspace. */
export function clearActiveWorkspaceCookie(store: CookieStore) {
  store.delete(ACTIVE_WORKSPACE_COOKIE)
}
