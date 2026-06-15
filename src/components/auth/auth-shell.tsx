import Link from "next/link";
import { SVGIcon } from "../ui/svg-icon";

/** Clean centered auth card — border only, no shadow, small radius. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 pb-12 pt-8">
      <div className="w-full max-w-md">
        <div className="mb-2 flex justify-center">
          <Link
            href="/"
            className="font-sebenta text-xl font-bold tracking-tight text-foreground"
            aria-label="MakingFlow home"
          >
            <SVGIcon
              src="/logo/logo.svg"
              preserveColors
              className="size-10 rounded"
            />
          </Link>
        </div>

        <div className="rounded-lg bg-background p-6 sm:p-7">
          <div className="mb-6 space-y-1.5 text-center">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {footer}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Inline, accessible error banner for the top of a form. */
export function AuthError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  );
}

/** Labelled rule, e.g. "or". */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="relative my-5">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-background px-3 text-xs text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}
