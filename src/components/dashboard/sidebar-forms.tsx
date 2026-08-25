"use client"

import { Fragment, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icon } from "@/components/ui/icon"
import { showToast } from "@/components/ui/toast"
import { FormRowMenu } from "@/components/dashboard/form-row-menu"
import { FolderRowMenu } from "@/components/dashboard/folder-row-menu"
import { createFolder } from "@/lib/actions/folders"
import type { FormSummary } from "@/components/dashboard/command-menu"
import type { WorkspaceFolder } from "@/lib/data/folders"

const UNCATEGORIZED_CAP = 10

const ROW_CLS =
  "text-sidebar-foreground/70 hover:text-sidebar-foreground data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-foreground"

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

function FormRow({
  form,
  folders,
  active,
}: {
  form: FormSummary
  folders: { id: string; name: string }[]
  active: boolean
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={form.title || "Untitled form"} className={ROW_CLS}>
        <Link href={`/forms/${form.id}`} prefetch className="flex w-full min-w-0 items-center">
          <span className="min-w-0 flex-1 truncate">{form.title || "Untitled form"}</span>
        </Link>
      </SidebarMenuButton>
      <FormRowMenu
        formId={form.id}
        title={form.title || "Untitled form"}
        status={form.status}
        publicId={form.publicId}
        folders={folders}
        currentFolderId={form.folderId ?? null}
      />
    </SidebarMenuItem>
  )
}

/**
 * The sidebar "Forms" group, organized into collapsible folders + an
 * Uncategorized list. Folder CRUD lives here; "Move to folder" lives on each
 * form's row menu. Expand state persists across in-app navigation (the dashboard
 * layout isn't remounted) and starts with the active form's folder open.
 */
export function SidebarForms({
  forms,
  folders,
  onSearch,
}: {
  forms: FormSummary[]
  folders: WorkspaceFolder[]
  onSearch: () => void
}) {
  const pathname = usePathname() ?? ""
  const router = useRouter()
  const menuFolders = folders.map((f) => ({ id: f.id, name: f.name }))

  const byFolder = new Map<string, FormSummary[]>()
  const uncategorized: FormSummary[] = []
  for (const f of forms) {
    if (f.folderId) {
      const arr = byFolder.get(f.folderId) ?? []
      arr.push(f)
      byFolder.set(f.folderId, arr)
    } else {
      uncategorized.push(f)
    }
  }

  const activeForm = forms.find((f) => pathname.startsWith(`/forms/${f.id}`))
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    activeForm?.folderId ? new Set([activeForm.folderId]) : new Set(),
  )
  const [newOpen, setNewOpen] = useState(false)
  const [newName, setNewName] = useState("")
  const [pending, startTransition] = useTransition()

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onCreateFolder() {
    const name = newName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await createFolder(name)
      if (res.success) {
        showToast("Folder created", { type: "success" })
        setNewOpen(false)
        setNewName("")
        router.refresh()
      } else {
        showToast(res.error ?? "Couldn't create the folder", { type: "error" })
      }
    })
  }

  const shownUncat = uncategorized.slice(0, UNCATEGORIZED_CAP)

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>Forms</SidebarGroupLabel>
      <SidebarGroupAction
        title="New folder"
        onClick={() => setNewOpen(true)}
        className="[&>svg]:size-3.5"
      >
        <Icon name="plus" className="size-3.5" />
        <span className="sr-only">New folder</span>
      </SidebarGroupAction>

      <SidebarGroupContent>
        <SidebarMenu>
          {forms.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No forms yet</p>
          ) : null}

          {folders.map((folder) => {
            const folderForms = byFolder.get(folder.id) ?? []
            const open = expanded.has(folder.id)
            return (
              <Fragment key={folder.id}>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => toggle(folder.id)}
                    aria-expanded={open}
                    className={ROW_CLS}
                  >
                    <Chevron open={open} />
                    <Icon name="folder" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {folderForms.length}
                    </span>
                  </SidebarMenuButton>
                  <FolderRowMenu folderId={folder.id} name={folder.name} />
                </SidebarMenuItem>
                {/* Children live OUTSIDE the folder's menu-item: a folder and its
                    forms both carry `group/menu-item`, and a hovered ancestor of
                    that group reveals EVERY descendant row's action — so nesting
                    them made one hover light up all the ⋯ menus at once. */}
                {open ? (
                  <li>
                    <SidebarMenuSub>
                      {folderForms.length === 0 ? (
                        <p className="px-2 py-1 text-xs text-muted-foreground">Empty</p>
                      ) : (
                        folderForms.map((form) => (
                          <FormRow
                            key={form.id}
                            form={form}
                            folders={menuFolders}
                            active={pathname.startsWith(`/forms/${form.id}`)}
                          />
                        ))
                      )}
                    </SidebarMenuSub>
                  </li>
                ) : null}
              </Fragment>
            )
          })}

          {shownUncat.map((form) => (
            <FormRow
              key={form.id}
              form={form}
              folders={menuFolders}
              active={pathname.startsWith(`/forms/${form.id}`)}
            />
          ))}
        </SidebarMenu>

        {forms.length > 0 ? (
          <button
            type="button"
            onClick={onSearch}
            className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Icon name="search" className="size-4 shrink-0" />
            <span>Search forms ({forms.length})</span>
          </button>
        ) : null}
      </SidebarGroupContent>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                e.preventDefault()
                onCreateFolder()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onCreateFolder} disabled={pending || !newName.trim()}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarGroup>
  )
}
