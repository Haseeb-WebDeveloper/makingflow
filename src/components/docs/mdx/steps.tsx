/**
 * Numbered setup steps.
 *
 * Lifted from the MCP page's per-client instructions, where the numbered-pill
 * treatment already existed inline. Made ambient so any document can use it —
 * "add a webhook", "connect Sheets" and every future integration guide are the
 * same shape, and each one hand-rolling it is how four tables ended up
 * assembled four ways.
 */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="not-prose my-4 space-y-3 text-[0.9375rem] leading-7 text-foreground/90">{children}</ol>
}

export function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
        {n}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  )
}
