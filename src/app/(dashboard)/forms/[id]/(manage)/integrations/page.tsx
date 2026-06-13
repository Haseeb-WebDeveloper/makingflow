import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Icon } from "@/components/ui/icon"
import { IntegrationsPanel } from "@/components/forms/integrations-panel"
import { getGoogleSheetsState } from "@/lib/data/integrations"

export const metadata: Metadata = { title: "Integrations · MakingFlow" }

export default async function FormIntegrationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const state = await getGoogleSheetsState(id)
  if (!state) notFound()

  return (
    <div className="max-w-4xl">
      <p className="text-sm text-muted-foreground">
        Integrations are connected once per workspace and apply to every form. Sync runs
        automatically and never blocks a response — if an integration is down, the submission is
        still saved.
      </p>

      <div className="mt-5">
        <IntegrationsPanel formId={id} state={state} />
      </div>

      <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-dashed border-border p-3.5 text-sm text-muted-foreground">
        <Icon name="info-square" className="mt-0.5 size-4 shrink-0" />
        <p>
          The toggle here pauses or resumes Google Sheets for this form only. Added questions after
          it started syncing? Toggle it off and on to refresh the spreadsheet&apos;s columns. You
          can also export responses as CSV from the Submissions tab anytime.
        </p>
      </div>
    </div>
  )
}
