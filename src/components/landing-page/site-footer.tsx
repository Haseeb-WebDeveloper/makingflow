import Link from "next/link"

type FooterLink = { name: string; href: string }

const QUICK: FooterLink[] = [
  { name: "Home", href: "/" },
  { name: "Features", href: "/#features" },
  { name: "Pricing", href: "/#pricing" },
  { name: "Integration", href: "/#integration" },
  { name: "Terms", href: "/terms" },
  { name: "Privacy", href: "/privacy" },
]

const SOCIALS: FooterLink[] = [
  { name: "X / Twitter", href: "#" },
  { name: "LinkedIn", href: "#" },
  { name: "Instagram", href: "#" },
  { name: "Discord", href: "#" },
]

/** Marketing-site footer — brand, link columns, contact, and a newsletter. */
export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1.1fr_1.6fr]">
          {/* About */}
          <div className="max-w-xs">
            <Link href="/" className="flex items-center gap-2.5" aria-label="MakingFlow home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo/logo.svg" alt="" className="size-6 rounded" />
              <span className="font-sebenta text-lg font-bold tracking-tight text-foreground">
                MakingFlow
              </span>
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              An AI form builder that turns a sentence into a smart form, adapts it to every
              respondent, and hands back clean answers. Built by Figmenta.
            </p>
          </div>

          {/* Quick Links */}
          <FooterCol title="Quick Links" links={QUICK} />

          {/* Socials */}
          <FooterCol title="Socials" links={SOCIALS} />

          {/* Contact */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">Contact</p>
            <ul className="mt-3 space-y-2.5 text-sm text-muted-foreground">
              <li>+1 (650) 123-4567</li>
              <li>
                <a
                  href="mailto:hello@makingflow.com"
                  className="transition-colors hover:text-foreground"
                >
                  hello@makingflow.com
                </a>
              </li>
              <li>Figmenta, European Union</li>
            </ul>
          </div>

          {/* Stay updated */}
          <div className="max-w-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-foreground">
              Stay updated
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Product news and the occasional tip. No noise.
            </p>
            <form action="/auth/signup" className="mt-4 flex gap-2">
              <input
                type="email"
                name="email"
                required
                placeholder="you@company.com"
                aria-label="Email address"
                className="h-10 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-foreground/40"
              />
              <button
                type="submit"
                className="inline-flex h-10 shrink-0 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
              >
                Subscribe
              </button>
            </form>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row">
          <span>© 2026 Figmenta. All rights reserved.</span>
          <span>Made in the EU</span>
        </div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</p>
      <ul className="mt-3 space-y-2.5">
        {links.map((link) => (
          <li key={link.name}>
            <Link
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
