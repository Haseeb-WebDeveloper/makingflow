import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Icon } from "@/components/ui/icon"
import { IntegrationsPanel } from "@/components/forms/integrations-panel"
import { getGoogleSheetsState, getFormWebhooks, getFormEmail } from "@/lib/data/integrations"
import { getRequiredUser } from "@/lib/auth/session"

export const metadata: Metadata = { title: "Integrations · MakingFlow" }

export default async function FormIntegrationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [state, webhooks, email, user] = await Promise.all([
    getGoogleSheetsState(id),
    getFormWebhooks(id),
    getFormEmail(id),
    getRequiredUser(),
  ])
  if (!state) notFound()

  return (
    <div className="max-w-4xl lg:max-w-[62.222vw]">
      <p className="text-sm lg:text-[0.972vw] text-muted-foreground">
        Integrations are connected once per workspace and apply to every form. Sync runs
        automatically and never blocks a response — if an integration is down, the submission is
        still saved.
      </p>

      <div className="mt-5 lg:mt-[1.389vw]">
        <IntegrationsPanel
          formId={id}
          state={state}
          webhooks={webhooks}
          email={email}
          ownerEmail={user.email}
        />
      </div>

      <div className="mt-6 lg:mt-[1.667vw] flex items-start gap-2.5 lg:gap-[0.694vw] rounded-lg lg:rounded-[0.694vw] border border-dashed border-border p-3.5 lg:p-[0.972vw] text-sm lg:text-[0.972vw] text-muted-foreground">
        <Icon name="info-square" className="mt-0.5 lg:mt-[0.139vw] size-4 lg:size-[1.111vw] shrink-0" />
        <p>
          The toggle here pauses or resumes Google Sheets for this form only. Added questions after
          it started syncing? Toggle it off and on to refresh the spreadsheet&apos;s columns. You
          can also export responses as CSV from the Submissions tab anytime.
        </p>
      </div>
    </div>
  )
}
