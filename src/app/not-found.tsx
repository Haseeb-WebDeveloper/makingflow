import Link from "next/link"

/** App-wide 404. Rendered within the root layout, so app styling applies. */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <p className="text-5xl font-bold tracking-tight text-foreground">404</p>
      <h1 className="mt-3 text-lg font-semibold text-foreground">Page not found</h1>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/forms"
        className="mt-6 inline-flex h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
      >
        Back to MakingFlow
      </Link>
    </div>
  )
}
