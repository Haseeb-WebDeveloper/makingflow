import Link from "next/link"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Sparkline } from "@/components/dashboard/sparkline"
import type { FormOverviewRow } from "@/lib/data/analytics"

const AVATAR_COLORS = ["var(--primary)", "var(--chart-3)", "var(--chart-4)"]

const STATUS_STYLES: Record<string, string> = {
  published: "bg-success/10 text-success",
  draft: "bg-muted text-muted-foreground",
  closed: "bg-destructive/10 text-destructive",
  archived: "bg-muted text-muted-foreground",
}

export function FormsOverviewTable({ forms }: { forms: FormOverviewRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <Th>Form</Th>
            <Th className="w-28">Trend</Th>
            <Th className="w-28">Responses</Th>
            <Th className="w-36">Completion</Th>
            <Th className="w-28">Status</Th>
            <Th className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {forms.map((f) => (
            <TableRow key={f.id} className="group">
              <TableCell className="py-0">
                <Link href={`/forms/${f.id}`} className="flex items-center gap-3 py-2.5">
                  <Avatar title={f.title} id={f.id} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {f.title || "Untitled form"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Updated {formatDate(f.updatedAt)}
                    </span>
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                <Sparkline data={f.spark} />
              </TableCell>
              <TableCell>
                <span className="text-sm text-foreground">{f.submissions.toLocaleString()}</span>
                {f.views > 0 ? (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    · {f.views.toLocaleString()} views
                  </span>
                ) : null}
              </TableCell>
              <TableCell>
                <Completion rate={f.completionRate} />
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                    STATUS_STYLES[f.status] ?? STATUS_STYLES.draft
                  }`}
                >
                  <span className="size-1.5 rounded-full bg-current opacity-70" />
                  {f.status}
                </span>
              </TableCell>
              <TableCell className="py-0 text-right">
                <Link
                  href={`/forms/${f.id}`}
                  aria-label={`Open ${f.title}`}
                  className="inline-grid size-8 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <TableHead
      className={`text-[11px] font-medium uppercase tracking-wide text-muted-foreground ${className ?? ""}`}
    >
      {children}
    </TableHead>
  )
}

function Avatar({ title, id }: { title: string; id: string }) {
  const letter = (title.trim()[0] ?? "F").toUpperCase()
  const hash = id.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  const color = AVATAR_COLORS[hash % AVATAR_COLORS.length]
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-md text-sm font-semibold"
      style={{ backgroundColor: `color-mix(in oklab, ${color} 12%, transparent)`, color }}
    >
      {letter}
    </span>
  )
}

function Completion({ rate }: { rate: number | null }) {
  if (rate == null) return <span className="text-sm text-muted-foreground">—</span>
  const pct = Math.min(100, Math.round(rate * 100))
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  )
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(date)
}
