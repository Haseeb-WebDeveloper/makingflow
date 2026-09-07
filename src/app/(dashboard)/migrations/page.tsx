import type { Metadata } from "next"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { CardShell } from "@/components/integrations/cards"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { SVGIcon } from "@/components/ui/svg-icon"
import { ImportTallyDialog } from "@/components/forms/import-tally-dialog"

/**
 * Bringing forms in from somewhere else.
 *
 * Moved off the Home page, where "Import from Tally" sat in the header next to
 * the range picker. It was the most prominent control on the dashboard for a
 * one-time task most people never do, and there was nowhere to put a second
 * source when one arrives — a header only has room for one button.
 */

export const metadata: Metadata = { title: "Migrations · MakingFlow" }

// Server Actions inherit the INVOKING PAGE'S time budget, and the Tally import
// now runs from here rather than from Home: one form can mean several API
// round-trips plus thousands of inserted responses. The default is too tight
// for a real migration, so this must move with the dialog.
export const maxDuration = 60

export default function MigrationsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Migrations"
        description="Already using another form builder? Bring your forms and their responses across."
      />

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CardShell>
          <div className="flex items-start justify-between gap-3">
            {/* Mask-rendered, NOT preserveColors. tally.svg is a bare black
                glyph on transparent — no background of its own — so preserving
                its colours would leave it invisible in dark mode. The logos in
                the integrations grid go the other way because each of those
                files carries its own full-bleed background. */}
            <SVGIcon src="/logo/tally.svg" className="size-9 text-foreground" />
          </div>

          <h3 className="mt-3 text-sm font-semibold text-foreground">Tally</h3>
          <p className="mt-1 flex-1 text-sm text-muted-foreground">
            Import forms with their questions, logic and responses. Paste a share link for a
            single form, or connect an API key to bring the whole account across at once.
          </p>

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
            <span className="text-xs text-muted-foreground">Forms and responses</span>
            <ImportTallyDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Icon name="download" className="size-4" />
                  Import
                </Button>
              }
            />
          </div>
        </CardShell>

      </div>
    </PageContainer>
  )
}
