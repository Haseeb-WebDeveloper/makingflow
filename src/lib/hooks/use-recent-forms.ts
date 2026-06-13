"use client"

import { useSyncExternalStore } from "react"

export type RecentForm = { id: string; title: string }

const KEY = "mf:recent-forms"
const MAX = 6
const EMPTY: RecentForm[] = []

function parse(raw: string | null): RecentForm[] {
  if (!raw) return EMPTY
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.id === "string") : EMPTY
  } catch {
    return EMPTY
  }
}

// Cache the snapshot so getSnapshot returns a stable reference unless the
// stored value actually changed (required by useSyncExternalStore).
let cachedRaw: string | null = null
let cachedVal: RecentForm[] = EMPTY

function getSnapshot(): RecentForm[] {
  if (typeof window === "undefined") return EMPTY
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(KEY)
  } catch {
    return EMPTY
  }
  if (raw === cachedRaw) return cachedVal
  cachedRaw = raw
  cachedVal = parse(raw)
  return cachedVal
}

function getServerSnapshot(): RecentForm[] {
  return EMPTY
}

function subscribe(onChange: () => void): () => void {
  const handler = (e: StorageEvent) => {
    if (!e.key || e.key === KEY) onChange()
  }
  window.addEventListener("storage", handler)
  return () => window.removeEventListener("storage", handler)
}

/** Record a form as recently viewed (most-recent first, deduped, capped). */
export function recordRecentForm(form: RecentForm) {
  if (typeof window === "undefined" || !form?.id) return
  try {
    const current = parse(window.localStorage.getItem(KEY))
    const next = [
      { id: form.id, title: form.title },
      ...current.filter((f) => f.id !== form.id),
    ].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
    // Notify same-tab listeners (the native event only fires cross-tab).
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }))
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/** Recently-viewed forms, kept in sync within the session. SSR-safe (empty until mount). */
export function useRecentForms(): RecentForm[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
