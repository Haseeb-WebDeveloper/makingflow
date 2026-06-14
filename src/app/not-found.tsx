import Link from "next/link"

/** App-wide 404. Rendered within the root layout, so app styling applies. */
export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 lg:px-[1.667vw] text-center">
      <p className="font-sebenta text-5xl lg:text-[3.333vw] font-bold tracking-tight text-foreground">404</p>
      <h1 className="mt-3 lg:mt-[0.833vw] text-lg lg:text-[1.25vw] font-semibold text-foreground">Page not found</h1>
      <p className="mt-1.5 lg:mt-[0.417vw] max-w-sm lg:max-w-[26.667vw] text-sm lg:text-[0.972vw] text-muted-foreground">
        The page you&apos;re looking for doesn&apos;t exist or may have moved.
      </p>
      <Link
        href="/forms"
        className="mt-6 lg:mt-[1.667vw] inline-flex h-10 lg:h-[2.778vw] items-center rounded-md lg:rounded-[0.556vw] bg-foreground px-4 lg:px-[1.111vw] text-sm lg:text-[0.972vw] font-medium text-background transition-colors hover:bg-foreground/90"
      >
        Back to MakingFlow
      </Link>
    </div>
  )
}
