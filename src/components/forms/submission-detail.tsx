"use client"

import { useTransition } from "react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { showToast } from "@/components/ui/toast"
import { generateSubmissionIntelligence } from "@/lib/actions/submissions"
import { formatDate, scoreVariant, type Cell } from "@/components/forms/submissions-table"

export type SubmissionDetail = {
  id: string
  submittedAt: string
  answers: { label: string; cell: Cell }[]
  aiSummary: string | null
  aiScore: number | null
  aiScreenReason: string | null
}

function AnswerValue({ cell }: { cell: Cell }) {
  if (typeof cell === "string") {
    return cell ? (
      <span className="whitespace-pre-wrap text-foreground">{cell}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    )
  }
  if (cell.files.length === 0) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {cell.files.map((f, i) => (
        <a
          key={i}
          href={f.url}
          target="_blank"
          rel="noreferrer"
          className="text-primary hover:underline"
        >
          {f.name}
        </a>
      ))}
    </span>
  )
}

/**
 * Right-side detail for a single response: AI summary + fit score at the top
 * (when intelligence is enabled), then every answer. Owners can (re)generate the
 * AI fields on demand — handy for responses collected before they opted in.
 */
export function SubmissionDetailSheet({
  detail,
  open,
  onOpenChange,
  intelligenceEnabled,
  onDelete,
}: {
  detail: SubmissionDetail | null
  open: boolean
  onOpenChange: (open: boolean) => void
  intelligenceEnabled: boolean
  onDelete: (id: string) => void
}) {
  const [generating, startGenerate] = useTransition()

  function generate() {
    if (!detail) return
    startGenerate(async () => {
      const res = await generateSubmissionIntelligence(detail.id)
      if (res.success) {
        showToast("AI insights generated", { type: "success" })
        // The server revalidates the page; the refreshed row flows back in.
      } else {
        showToast(res.error ?? "Couldn't generate insights", { type: "error" })
      }
    })
  }

  const hasAi = !!detail?.aiSummary || detail?.aiScore != null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Response</SheetTitle>
          <SheetDescription>
            {detail ? `Submitted ${formatDate(detail.submittedAt)}` : null}
          </SheetDescription>
        </SheetHeader>

        {detail ? (
          <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
            {intelligenceEnabled ? (
              <div className="mb-5 rounded-lg border border-border bg-muted/30 p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon name="star" className="size-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">AI insights</span>
                  </div>
                  {detail.aiScore != null ? (
                    <Badge variant={scoreVariant(detail.aiScore)}>{detail.aiScore} / 100</Badge>
                  ) : null}
                </div>

                {hasAi ? (
                  <>
                    {detail.aiSummary ? (
                      <p className="text-sm text-foreground">{detail.aiSummary}</p>
                    ) : null}
                    {detail.aiScreenReason ? (
                      <p className="mt-2 text-sm text-muted-foreground">{detail.aiScreenReason}</p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No insights yet for this response.
                  </p>
                )}

                <Button
                  variant="outline"
                  onClick={generate}
                  disabled={generating}
                  className="mt-3 h-8 px-3 text-xs"
                >
                  {generating ? "Generating…" : hasAi ? "Regenerate" : "Generate"}
                </Button>
              </div>
            ) : null}

            <dl className="space-y-4">
              {detail.answers.map((a, i) => (
                <div key={i}>
                  <dt className="mb-0.5 text-xs font-medium text-muted-foreground">
                    {a.label || `Question ${i + 1}`}
                  </dt>
                  <dd className="text-sm">
                    <AnswerValue cell={a.cell} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        <SheetFooter className="border-t border-border">
          {detail ? (
            <Button
              variant="ghost"
              onClick={() => onDelete(detail.id)}
              className="h-9 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Icon name="delete" className="size-4" />
              Delete response
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
