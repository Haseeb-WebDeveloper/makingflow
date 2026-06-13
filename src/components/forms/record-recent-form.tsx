"use client"

import { useEffect } from "react"
import { recordRecentForm } from "@/lib/hooks/use-recent-forms"

/** Records a form visit into the recent-forms list (for the ⌘K palette). Renders nothing. */
export function RecordRecentForm({ id, title }: { id: string; title: string }) {
  useEffect(() => {
    recordRecentForm({ id, title })
  }, [id, title])
  return null
}
