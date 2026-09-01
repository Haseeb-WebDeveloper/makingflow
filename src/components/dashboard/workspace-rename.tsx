"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { showToast } from "@/components/ui/toast"
import { renameWorkspace } from "@/lib/actions/workspaces"

/**
 * Rename the workspace, in place on its own header.
 *
 * Kept inline rather than behind a dialog: the name is right there, and this is
 * most often used once — when a workspace changes hands and is still called
 * after whoever happened to create it.
 */
export function WorkspaceRename({ name }: { name: string }) {
  const router = useRouter()
  const [editing, setEditing] = React.useState(false)
  const [value, setValue] = React.useState(name)
  const [pending, start] = React.useTransition()

  function save() {
    const next = value.trim()
    if (!next || next === name) {
      setEditing(false)
      setValue(name)
      return
    }
    start(async () => {
      const res = await renameWorkspace(next)
      if (res.success) {
        showToast("Workspace renamed", { type: "success" })
        setEditing(false)
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(name)
          setEditing(true)
        }}
        className="group flex min-w-0 items-center gap-1.5 text-left"
      >
        <span className="truncate text-base font-semibold text-foreground">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          Rename
        </span>
      </button>
    )
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Input
        autoFocus
        value={value}
        maxLength={60}
        disabled={pending}
        aria-label="Workspace name"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            save()
          }
          if (e.key === "Escape") {
            setEditing(false)
            setValue(name)
          }
        }}
        className="h-8 max-w-56"
      />
      <Button size="sm" onClick={save} disabled={pending || !value.trim()}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </div>
  )
}
