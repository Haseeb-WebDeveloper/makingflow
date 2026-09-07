import type { Metadata } from "next"
import { PageContainer, PageHeader } from "@/components/dashboard/page-shell"
import { CardShell } from "@/components/integrations/cards"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
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
            <div className="flex size-9 items-center justify-center rounded-md border border-border bg-muted">
              <Icon name="paper-download" className="size-5 text-foreground" />
            </div>
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

        {/* Not a placeholder for its own sake: with one real card the grid reads
            as though something failed to load, and this says the shape is
            deliberate. No tool names — promising a source we have not built is
            how a roadmap becomes a complaint. */}
        <div className="flex flex-col justify-center rounded-lg border border-dashed border-border p-4">
          <h3 className="text-sm font-semibold text-muted-foreground">More on the way</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            We&rsquo;re adding more sources as we grow. Tell us what you&rsquo;re moving from and
            we&rsquo;ll prioritise it.
          </p>
        </div>
      </div>
    </PageContainer>
  )
}
