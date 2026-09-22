"use client"

/**
 * "Download every CV as a zip."
 *
 * IT ARCHIVES WHAT THE TABLE IS SHOWING. If a search or a filter is active, the
 * zip holds the files from those responses and nothing else — the same rule the
 * CSV export follows, because a button that quietly ignores the filter chip
 * beside it is the bug this whole piece of work started from. The toast says
 * how many files came from how many responses, so the scope is visible after
 * the fact as well.
 *
 * ONE ARCHIVE DOWNLOADS ITSELF; SEVERAL GET A LIST. Cloudinary splits an
 * archive per resource type — a form collecting PDFs and images legitimately
 * produces two — and a browser cannot be navigated to two files at once, so
 * that case opens a small dialog instead of silently handing over one of them.
 */

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { showToast } from "@/components/ui/toast"
import { requestMediaArchive } from "@/lib/actions/exports"
import { exportSpecSchema } from "@/lib/submissions/export-spec"
import type { Filter, MatchMode } from "@/lib/submissions/filter"

// Derived from the action rather than imported from export-media.ts, which is
// server-only — a type import would be erased, but the module must not appear
// in a client bundle at all.
type MediaArchive = Extract<
  Awaited<ReturnType<typeof requestMediaArchive>>,
  { success: true }
>["archives"][number]

export function MediaArchiveButton({
  formId,
  live,
}: {
  formId: string
  /** What the responses table is showing right now. */
  live: { search: string; filters: Filter[]; match: MatchMode }
}) {
  const [archives, setArchives] = useState<MediaArchive[] | null>(null)
  const [pending, start] = useTransition()

  const filtered = live.search.trim().length > 0 || live.filters.length > 0

  function download() {
    start(async () => {
      const res = await requestMediaArchive(
        formId,
        exportSpecSchema.parse({
          files: "zip-only",
          scope: {
            search: filtered ? live.search : undefined,
            filters: filtered ? live.filters : [],
            match: live.match,
          },
        }),
      )

      if (!res.success) {
        showToast(res.error, { type: "error" })
        return
      }

      const files = `${res.fileCount} ${res.fileCount === 1 ? "file" : "files"}`
      // Said out loud rather than swallowed: Cloudinary is asked to tolerate a
      // file that storage no longer has, so a short archive must announce
      // itself or it reads as the complete set.
      const shortfall =
        res.missing > 0
          ? `${res.missing} ${res.missing === 1 ? "file is" : "files are"} no longer in storage and could not be included.`
          : undefined
      const scope = filtered ? "From the responses you have filtered to." : undefined
      const description = [scope, shortfall].filter(Boolean).join(" ") || undefined

      if (res.archives.length === 1) {
        // A plain navigation, so the browser saves it: the URL carries
        // fl_attachment and the archive's own name.
        window.location.assign(res.archives[0].url)
        showToast(`Downloading ${files}`, {
          type: res.missing > 0 ? "warning" : "success",
          description,
        })
        return
      }
      if (shortfall) showToast(`${files} ready`, { type: "warning", description: shortfall })
      setArchives(res.archives)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={download}
        disabled={pending}
        title={
          filtered
            ? "Download the uploaded files from the responses you have filtered to"
            : "Download every uploaded file as a zip"
        }
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
      >
        <Icon name="folder" className="size-4" />
        {pending ? "Zipping…" : "Files (ZIP)"}
      </button>

      <Dialog open={archives !== null} onOpenChange={(open) => !open && setArchives(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Your files are ready</DialogTitle>
            <DialogDescription>
              They came out as {archives?.length} archives, because images and documents are stored
              separately. Download each one.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-2">
            {archives?.map((a) => (
              <li key={a.url}>
                <a
                  href={a.url}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Icon name="download" className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{a.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {a.fileCount} {a.fileCount === 1 ? "file" : "files"}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchives(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
