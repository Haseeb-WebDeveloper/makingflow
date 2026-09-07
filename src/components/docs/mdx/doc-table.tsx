import { cn } from "@/lib/utils"

/**
 * The documentation table, once.
 *
 * The two pages this replaces held four tables assembled four slightly
 * different ways — `thin-scroll overflow-x-auto` in one order on one page and
 * the other order on the other, rows with and without `align-top`, six
 * variations of the cell class depending on whether the content was monospace,
 * emphasised, or must not wrap. Around two dozen className strings, none of
 * which encoded a decision anyone made on purpose.
 *
 * The horizontal scroll wrapper is not optional: header names like
 * `X-MakingFlow-Signature-V2` do not wrap, and without it a phone gets a table
 * that pushes the whole page sideways.
 */
export function DocTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="not-prose thin-scroll my-4 overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  )
}

export function DocTableHead({ children }: { children: React.ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-border">{children}</tr>
    </thead>
  )
}

export function DocTableBody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>
}

export function DocRow({ children }: { children: React.ReactNode }) {
  return <tr className="border-b border-border/60 align-top">{children}</tr>
}

export function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2.5 pr-4 font-medium text-foreground last:pr-0">{children}</th>
}

export function Td({
  children,
  mono,
  nowrap,
  emphasis,
}: {
  children: React.ReactNode
  /** Header names, scopes, tool names — anything the reader will retype. */
  mono?: boolean
  nowrap?: boolean
  /** Full-contrast text, for the column that names the thing. */
  emphasis?: boolean
}) {
  return (
    <td
      className={cn(
        "py-2.5 pr-4 text-foreground/90 last:pr-0",
        mono && "font-mono text-xs",
        nowrap && "whitespace-nowrap",
        emphasis && "text-foreground",
      )}
    >
      {children}
    </td>
  )
}
