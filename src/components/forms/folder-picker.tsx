"use client";

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { moveFormToFolder, createFolder } from "@/lib/actions/folders";
import type { WorkspaceFolder } from "@/lib/data/folders";
import { SVGIcon } from "../ui/svg-icon";

const NONE = "__none";
const NEW = "__new";

/**
 * File a form into a folder (or leave it uncategorized) from the publish/share
 * dialog. Calls the server actions directly — the form is always persisted by
 * the time this dialog opens, so there's no save-then-move dance. A "New folder…"
 * option creates a folder inline and moves the form into it in one step.
 */
export function FormFolderPicker({
  formId,
  folders,
  currentFolderId,
}: {
  formId: string;
  folders: WorkspaceFolder[];
  currentFolderId: string | null;
}) {
  const [list, setList] = useState<WorkspaceFolder[]>(folders);
  const [selId, setSelId] = useState<string>(currentFolderId ?? "");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  async function move(folderId: string | null) {
    setPending(true);
    const res = await moveFormToFolder(formId, folderId);
    setPending(false);
    if (res.success) {
      setSelId(folderId ?? "");
      showToast(folderId ? "Moved to folder" : "Removed from folder", {
        type: "success",
      });
    } else {
      showToast(res.error ?? "Couldn't move the form", { type: "error" });
    }
  }

  function onSelect(value: string) {
    if (value === NEW) {
      setCreating(true);
      return;
    }
    setCreating(false);
    void move(value === NONE ? null : value);
  }

  async function createAndMove() {
    const clean = name.trim();
    if (!clean) return;
    setPending(true);
    const res = await createFolder(clean);
    if (!res.success) {
      setPending(false);
      showToast(res.error ?? "Couldn't create the folder", { type: "error" });
      return;
    }
    const created = { id: res.id, name: clean };
    setList((prev) =>
      [...prev, created].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      )
    );
    const moved = await moveFormToFolder(formId, res.id);
    setPending(false);
    if (moved.success) {
      setSelId(res.id);
      setCreating(false);
      setName("");
      showToast("Folder created", { type: "success" });
    } else {
      showToast(moved.error ?? "Couldn't move the form", { type: "error" });
    }
  }

  return (
    <div className="space-y-2.5">
      <Select value={selId || NONE} onValueChange={onSelect} disabled={pending}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="No folder" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No folder (Uncategorized)</SelectItem>
          {list.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.name}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={NEW}>
            <SVGIcon src="/icons/plus.svg" className="size-4" /> New folder
          </SelectItem>
        </SelectContent>
      </Select>

      {creating ? (
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void createAndMove();
              }
            }}
            placeholder="Folder name"
            autoFocus
            maxLength={100}
            className="min-w-0 flex-1 rounded-md border border-input bg-input/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
          />
          <Button
            disabled={pending || !name.trim()}
            onClick={() => void createAndMove()}
            className="shrink-0"
          >
            {pending ? "Creating…" : "Create"}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              setCreating(false);
              setName("");
            }}
            className="shrink-0"
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}
