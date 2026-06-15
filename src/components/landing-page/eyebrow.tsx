/** Small brand-tinted section label pill — replaces the plain text eyebrows so
 *  each section opens with a touch of color. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-primary">
      <span className="size-1.5 rounded-full bg-primary" />
      {children}
    </span>
  )
}
