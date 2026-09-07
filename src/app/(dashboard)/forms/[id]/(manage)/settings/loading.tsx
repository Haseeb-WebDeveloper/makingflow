import { Skeleton } from "@/components/ui/skeleton"

/**
 * A form's Settings tab, loading.
 *
 * SETTINGS ARE MOSTLY LABELS. Four section headings and every row's title are
 * fixed strings — the only thing a query decides is where each switch sits and
 * what is typed in each field. So the page is drawn in full and only the
 * controls on the right-hand edge wait.
 *
 * The row titles are duplicated from form-settings.tsx, which is a real cost;
 * they are here because a settings page whose labels appear one beat late is
 * the most jarring version of this problem, and the alternative — splitting
 * every row into a shared descriptor — is a larger change than this screen
 * currently justifies.
 */
const SECTIONS: { heading: string; rows: string[] }[] = [
  {
    heading: "Response experience",
    rows: [
      "How respondents fill the form",
      "Persona & tone",
      "Adaptive follow-up questions",
      "Clarify vague answers",
    ],
  },
  {
    heading: "Submission intelligence",
    rows: ["AI summary", "Screening & scoring"],
  },
  {
    heading: "Access",
    rows: [
      "Close form",
      "Limit submissions",
      "Close on a date",
      "Prevent duplicate submissions",
    ],
  },
  {
    heading: "Behavior",
    rows: [
      "Redirect on completion",
      "Progress bar",
      "Fill-style chooser",
      "Submit button label",
    ],
  },
]

export default function FormSettingsLoading() {
  return (
    <div className="space-y-6">
      {SECTIONS.map((section, i) => (
        <div key={section.heading}>
          <h2
            className={`mb-1 text-sm font-semibold text-foreground${i > 0 ? " mt-8" : ""}`}
          >
            {section.heading}
          </h2>
          <div className="rounded-lg border border-border px-4">
            {section.rows.map((title) => (
              <div key={title} className="border-b border-border py-4 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <Skeleton className="mt-1.5 h-4 w-3/4" />
                  </div>
                  {/* The switch, at the size a switch renders. */}
                  <Skeleton className="mt-0.5 h-5 w-9 shrink-0 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
