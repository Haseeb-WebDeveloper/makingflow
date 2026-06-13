import { notFound } from "next/navigation"
import Link from "next/link"
import { getFormShell } from "@/lib/data/forms"
import { FormDetailTabs } from "@/components/forms/form-detail-tabs"
import { FormAssistant } from "@/components/forms/form-assistant"
import { RecordRecentForm } from "@/components/forms/record-recent-form"
import { Icon } from "@/components/ui/icon"

/**
 * Management chrome for a single form: title + status, an Edit button into the
 * builder, the tab bar (Insights / Submissions / Share / Integrations /
 * Settings), and a floating AI assistant scoped to this form. The builder
 * itself lives at /forms/[id]/edit — OUTSIDE this route group — so it renders
 * full-screen without this chrome.
 */
export default async function FormManageLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const shell = await getFormShell(id)
  if (!shell) notFound()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordRecentForm id={id} title={shell.title || "Untitled form"} />
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-6xl px-6 pt-6 sm:px-8">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="truncate font-sebenta text-xl font-bold tracking-tight text-foreground">
                  {shell.title || "Untitled form"}
                </h1>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground">
                  {shell.status}
                </span>
              </div>
            </div>
            <Link
              href={`/forms/${id}/edit`}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-foreground px-3.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
            >
              <Icon name="edit" className="size-4" />
              Edit
            </Link>
          </div>
          <FormDetailTabs formId={id} />
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8 pb-40 sm:px-8">
          {children}
        </div>
        <FormAssistant formId={id} formTitle={shell.title || "this form"} />
      </div>
    </div>
  )
}
