"use client"

import { useState, useTransition } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Icon } from "@/components/ui/icon"
import { showToast } from "@/components/ui/toast"
import {
  duplicateForm,
  renameForm,
  publishForm,
  unpublishForm,
  deleteForm,
} from "@/lib/actions/forms"
import { moveFormToFolder, createFolder } from "@/lib/actions/folders"

/**
 * Per-form quick-actions menu in the sidebar — revealed on hover/focus. Keeps
 * the common operations (edit, copy link, duplicate, rename, publish/unpublish,
 * delete) one click away instead of buried inside the form's detail pages.
 */
export function FormRowMenu({
  formId,
  title,
  status,
  publicId,
  folders,
  currentFolderId,
}: {
  formId: string
  title: string
  status: string
  publicId?: string | null
  /** When provided, a "Move to folder" submenu is shown. */
  folders?: { id: string; name: string }[]
  currentFolderId?: string | null
}) {
  const router = useRouter()
  const pathname = usePathname() ?? ""
  const [pending, startTransition] = useTransition()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newName, setNewName] = useState(title)
  const [newFolderName, setNewFolderName] = useState("")
  const published = status === "published"

  function onCreateFolderAndMove() {
    const name = newFolderName.trim()
    if (!name) return
    startTransition(async () => {
      const res = await createFolder(name)
      if (!res.success) {
        showToast(res.error ?? "Couldn't create the folder", { type: "error" })
        return
      }
      const move = await moveFormToFolder(formId, res.id)
      if (move.success) {
        showToast(`Moved to ${name}`, { type: "success" })
        setNewFolderOpen(false)
        setNewFolderName("")
        router.refresh()
      } else {
        showToast(move.error ?? "Couldn't move the form", { type: "error" })
      }
    })
  }

  function run(
    action: () => Promise<{ success: boolean; error?: string }>,
    ok: string,
    after?: () => void,
  ) {
    startTransition(async () => {
      const res = await action()
      if (res.success) {
        showToast(ok, { type: "success" })
        router.refresh()
        after?.()
      } else {
        showToast(res.error ?? "Something went wrong", { type: "error" })
      }
    })
  }

  async function copyLink() {
    if (!publicId) return
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/f/${publicId}`)
      showToast("Link copied", { type: "success" })
    } catch {
      showToast("Couldn't copy the link", { type: "error" })
    }
  }

  function onDuplicate() {
    startTransition(async () => {
      const res = await duplicateForm(formId)
      if (res.success && res.id) {
        showToast("Form duplicated", { type: "success" })
        router.push(`/forms/${res.id}/edit`)
      } else {
        showToast(res.error ?? "Could not duplicate the form", { type: "error" })
      }
    })
  }

  function onRename() {
    run(() => renameForm(formId, newName), "Form renamed", () => setRenameOpen(false))
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteForm(formId)
      if (res.success) {
        showToast("Form deleted", { type: "success" })
        setDeleteOpen(false)
        // If we're currently viewing the deleted form, leave it.
        if (pathname.startsWith(`/forms/${formId}`)) router.push("/forms")
        else router.refresh()
      } else {
        showToast(res.error ?? "Could not delete the form", { type: "error" })
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Form actions">
            <Icon name="more-circle" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem asChild>
            <Link href={`/forms/${formId}/edit`}>
              <Icon name="edit" className="size-4 text-muted-foreground" />
              Edit
            </Link>
          </DropdownMenuItem>
          {published && publicId ? (
            <DropdownMenuItem onSelect={() => void copyLink()}>
              <Icon name="paper" className="size-4 text-muted-foreground" />
              Copy link
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            onSelect={() => {
              setNewName(title)
              setRenameOpen(true)
            }}
          >
            <Icon name="edit-square" className="size-4 text-muted-foreground" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDuplicate} disabled={pending}>
            <Icon name="document" className="size-4 text-muted-foreground" />
            Duplicate
          </DropdownMenuItem>
          {published ? (
            <DropdownMenuItem
              onSelect={() => run(() => unpublishForm(formId), "Form unpublished")}
              disabled={pending}
            >
              <Icon name="hide" className="size-4 text-muted-foreground" />
              Unpublish
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              onSelect={() => run(() => publishForm(formId), "Your form is live 🎉")}
              disabled={pending}
            >
              <Icon name="show" className="size-4 text-muted-foreground" />
              Publish
            </DropdownMenuItem>
          )}
          {folders ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Icon name="folder" className="size-4 text-muted-foreground" />
                Move to folder
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                {folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() =>
                      run(() => moveFormToFolder(formId, f.id), `Moved to ${f.name}`)
                    }
                    disabled={pending || f.id === currentFolderId}
                  >
                    <Icon name="folder" className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {f.id === currentFolderId ? (
                      <Icon name="tick-square" className="size-4 text-foreground" />
                    ) : null}
                  </DropdownMenuItem>
                ))}
                {currentFolderId ? (
                  <DropdownMenuItem
                    onSelect={() =>
                      run(() => moveFormToFolder(formId, null), "Removed from folder")
                    }
                    disabled={pending}
                  >
                    <Icon name="close-square" className="size-4 text-muted-foreground" />
                    Remove from folder
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    setNewFolderName("")
                    setNewFolderOpen(true)
                  }}
                >
                  <Icon name="plus" className="size-4 text-muted-foreground" />
                  New folder…
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => setDeleteOpen(true)}
            className="text-destructive focus:text-destructive"
          >
            <Icon name="delete" className="size-4 text-destructive" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename form</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Form name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                e.preventDefault()
                onRename()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onRename} disabled={pending || !newName.trim()}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New folder (then move this form into it) */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="Folder name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && newFolderName.trim()) {
                e.preventDefault()
                onCreateFolderAndMove()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onCreateFolderAndMove} disabled={pending || !newFolderName.trim()}>
              {pending ? "Creating…" : "Create & move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this form?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes “{title || "Untitled form"}” and all of its
              submissions. Uploaded files and images are also erased from
              storage. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                onDelete()
              }}
              disabled={pending}
              className="bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:ring-destructive/20"
            >
              {pending ? "Deleting…" : "Delete form"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
