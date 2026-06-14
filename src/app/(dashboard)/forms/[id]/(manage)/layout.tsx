import { notFound } from "next/navigation"
import { headers } from "next/headers"
import Link from "next/link"
import { getDefaultWorkspace } from "@/lib/auth/session"
import { getFormShell, getFormSettings } from "@/lib/data/forms"
import { getActiveDomains } from "@/lib/data/domains"
import { FormDetailTabs } from "@/components/forms/form-detail-tabs"
import { FormAssistant } from "@/components/forms/form-assistant"
import { FormPublishButton } from "@/components/forms/form-publish-button"
import { RecordRecentForm } from "@/components/forms/record-recent-form"
import { Icon } from "@/components/ui/icon"

/**
 * Management chrome for a single form: title + status, Publish/Share + Edit
 * buttons, the tab bar (Insights / Submissions / Integrations / Settings), and
 * a floating AI assistant scoped to this form. Publishing, the live link,
 * custom domain, and submission settings live in the Publish/Share dialog
 * (same one the builder uses). The builder itself lives at /forms/[id]/edit —
 * OUTSIDE this route group — so it renders full-screen without this chrome.
 */
export default async function FormManageLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const workspace = await getDefaultWorkspace()
  if (!workspace) notFound()
  const [shell, domains, settings] = await Promise.all([
    getFormShell(id, workspace.id),
    getActiveDomains(workspace.id),
    getFormSettings(id, workspace.id),
  ])
  if (!shell) notFound()

  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
  const origin = `${proto}://${host}`

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RecordRecentForm id={id} title={shell.title || "Untitled form"} />
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-6xl lg:max-w-[80vw] px-6 lg:px-[1.667vw] pt-6 lg:pt-[1.667vw] sm:px-8">
          <div className="flex items-start justify-between gap-4 lg:gap-[1.111vw]">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5 lg:gap-[0.694vw]">
                <h1 className="truncate font-sebenta text-xl lg:text-[1.389vw] font-bold tracking-tight text-foreground">
                  {shell.title || "Untitled form"}
                </h1>
                <span className="shrink-0 rounded-full border border-border px-2 lg:px-[0.556vw] py-0.5 lg:py-[0.139vw] text-xs lg:text-[0.833vw] capitalize text-muted-foreground">
                  {shell.status}
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 lg:gap-[0.556vw]">
              <FormAssistant formId={id} formTitle={shell.title || "this form"} />
              <Link
                href={`/forms/${id}/edit`}
                className="inline-flex h-9 lg:h-[2.5vw] items-center gap-1.5 lg:gap-[0.417vw] rounded-md lg:rounded-[0.556vw] border border-border bg-background px-3.5 lg:px-[0.972vw] text-sm lg:text-[0.972vw] font-medium text-foreground transition-colors hover:bg-muted"
              >
                <Icon name="edit" className="size-4 lg:size-[1.111vw]" />
                Edit
              </Link>
              <FormPublishButton
                formId={shell.id}
                formTitle={shell.title || "this form"}
                initialStatus={shell.status}
                publicId={shell.publicId}
                origin={origin}
                domains={domains}
                initialDomainId={shell.customDomainId}
                initialSlug={shell.slug}
                initialDomainHost={shell.domain}
                settings={settings}
              />
            </div>
          </div>
          <FormDetailTabs formId={id} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mx-auto w-full max-w-6xl lg:max-w-[80vw] flex-1 px-6 lg:px-[1.667vw] py-8 lg:py-[2.222vw] sm:px-8">{children}</div>
      </div>
    </div>
  )
}
