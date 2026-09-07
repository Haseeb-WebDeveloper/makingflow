import { IntegrationCardSkeleton } from "@/components/dashboard/skeletons/integrations-skeleton"
import { Icon } from "@/components/ui/icon"

/**
 * A form's Integrations tab, loading.
 *
 * Both paragraphs on this tab are fixed copy explaining how syncing behaves,
 * and the five cards are always the same five in the same order. Only each
 * card's connection state is unknown, so only that greys out — the same card
 * placeholder the workspace Integrations page uses.
 */
export default function FormIntegrationsLoading() {
  return (
    <div className="max-w-4xl">
      <p className="text-sm text-muted-foreground">
        Integrations are connected once per workspace and apply to every form.
        Sync runs automatically and never blocks a response. If an integration
        is down, the submission is still saved.
      </p>

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <IntegrationCardSkeleton icon="/logo/google-sheet.svg" name="Google Sheets" />
        <IntegrationCardSkeleton icon="/logo/webhook.svg" name="Webhooks" />
        <IntegrationCardSkeleton icon="/logo/email.svg" name="Email notifications" />
        <IntegrationCardSkeleton icon="/logo/discord.svg" name="Discord" />
        <IntegrationCardSkeleton icon="/logo/notion.svg" name="Notion" />
      </div>

      <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-dashed border-border p-3.5 text-sm text-muted-foreground">
        <Icon name="info-square" className="mt-0.5 size-4 shrink-0" />
        <p>
          The toggle here pauses or resumes Google Sheets for this form only.
          Added questions after it started syncing? Toggle it off and on to
          refresh the spreadsheet&apos;s columns. You can also export responses
          as CSV from the Submissions tab anytime.
        </p>
      </div>
    </div>
  )
}
