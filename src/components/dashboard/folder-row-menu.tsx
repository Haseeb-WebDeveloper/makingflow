"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SidebarMenuAction } from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import { renameFolder, deleteFolder } from "@/lib/actions/folders"

/** Rename / delete actions for a folder row in the sidebar. */
export function FolderRowMenu({ folderId, name }: { folderId: string; name: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newName, setNewName] = useState(name)

  function onRename() {
    startTransition(async () => {
      const res = await renameFolder(folderId, newName)
      if (res.success) {
        showToast("Folder renamed", { type: "success" })
        setRenameOpen(false)
        router.refresh()
      } else {
        showToast(res.error ?? "Couldn't rename the folder", { type: "error" })
      }
    })
  }

  function onDelete() {
    startTransition(async () => {
      const res = await deleteFolder(folderId)
      if (res.success) {
        showToast("Folder deleted", { type: "success" })
        setDeleteOpen(false)
        router.refresh()
      } else {
        showToast(res.error ?? "Couldn't delete the folder", { type: "error" })
      }
    })
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction showOnHover aria-label="Folder actions">
            <Icon name="more-circle" />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem
            onSelect={() => {
              setNewName(name)
              setRenameOpen(true)
            }}
          >
            <Icon name="edit-square" className="size-4 text-muted-foreground" />
            Rename
          </DropdownMenuItem>
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

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
          </DialogHeader>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Folder name"
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

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this folder?</AlertDialogTitle>
            <AlertDialogDescription>
              “{name}” will be removed. Its forms aren&apos;t deleted — they move back to
              Uncategorized.
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
              {pending ? "Deleting…" : "Delete folder"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
