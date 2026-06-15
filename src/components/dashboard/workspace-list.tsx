"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { showToast } from "@/components/ui/toast"
import { switchWorkspace } from "@/lib/actions/team"

const PLAN_LABEL: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  business: "Business",
}

export type WorkspaceRow = {
  id: string
  name: string
  slug: string
  plan: string
  role: string
}

export function WorkspaceList({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceRow[]
  activeId: string | null
}) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function switchAndManage(id: string) {
    start(async () => {
      const res = await switchWorkspace(id)
      if (res.success) {
        router.push("/settings/workspace")
        router.refresh()
      } else {
        showToast(res.error, { type: "error" })
      }
    })
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Workspace</TableHead>
            <TableHead className="w-28">Plan</TableHead>
            <TableHead className="w-28">Role</TableHead>
            <TableHead className="w-32 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workspaces.map((w) => {
            const isActive = w.id === activeId
            return (
              <TableRow key={w.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded bg-foreground text-xs font-semibold text-background">
                      {w.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-sm font-medium text-foreground">
                        {w.name}
                        {isActive ? (
                          <Badge variant="secondary" className="font-normal">
                            Active
                          </Badge>
                        ) : null}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">/{w.slug}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {PLAN_LABEL[w.plan] ?? w.plan}
                </TableCell>
                <TableCell>
                  <Badge variant={w.role === "owner" ? "default" : "secondary"}>
                    {w.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {isActive ? (
                    <Button asChild variant="ghost" className="h-8 px-3">
                      <Link href="/settings/workspace">Manage</Link>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => switchAndManage(w.id)}
                      disabled={pending}
                      className="h-8 px-3"
                    >
                      Switch
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
