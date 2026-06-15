import { SiteHeader } from "@/components/landing-page/site-header"
import { SiteFooter } from "@/components/landing-page/site-footer"

/** Typography for legal prose — applied to the article so pages stay clean,
 *  semantic HTML (h2 / p / ul) without per-element class noise. */
const PROSE =
  "text-sm leading-relaxed text-muted-foreground " +
  "[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground " +
  "[&_h2:first-child]:mt-0 " +
  "[&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground " +
  "[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:mt-1.5 " +
  "[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-foreground/80 " +
  "[&_strong]:font-medium [&_strong]:text-foreground"

/** Page chrome for the legal pages (Terms, Privacy) — landing-page header,
 *  centered prose column, and a minimal footer. */
export function LegalShell({
  isAuthed,
  title,
  updated,
  children,
}: {
  isAuthed: boolean
  title: string
  updated: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader isAuthed={isAuthed} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-16 sm:px-8 sm:py-20">
        <header className="mb-10">
          <h1 className="font-sebenta text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">Last updated {updated}</p>
        </header>

        <article className={PROSE}>{children}</article>
      </main>

      <SiteFooter />
    </div>
  )
}
