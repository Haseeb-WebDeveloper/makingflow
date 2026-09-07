import { Icon } from "@/components/ui/icon"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * A form's Submissions tab, loading.
 *
 * The toolbar is not data — the search field and the Export button are the same
 * for every form, so they are drawn for real and simply inert.
 *
 * The TABLE HEADER genuinely is data here, unlike elsewhere: the columns are
 * this form's own questions. So the header row is a set of bars rather than
 * invented labels — writing plausible column names would be the one thing worse
 * than a grey box, because they would be wrong.
 */
export default function SubmissionsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-64 max-w-[60%]">
          <input
            disabled
            aria-hidden
            tabIndex={-1}
            placeholder="Search responses…"
            className="h-9 w-full rounded-md border border-input bg-input/30 px-3 text-sm text-muted-foreground"
          />
        </div>
        <div className="flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-muted-foreground">
          <Icon name="download" className="size-4" />
          Export
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <div className="flex items-center gap-4 border-b border-border px-4 py-3">
          {[34, 22, 18, 14].map((w, i) => (
            <Skeleton key={i} className="h-3.5" style={{ width: `${w}%` }} />
          ))}
        </div>
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0"
          >
            {[34, 22, 18, 14].map((w, j) => (
              <Skeleton key={j} className="h-4" style={{ width: `${w}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
