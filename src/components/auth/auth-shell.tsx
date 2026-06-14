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
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 lg:px-[1.389vw] py-12 lg:py-[3.333vw]">
      <div className="w-full max-w-sm lg:max-w-[26.667vw]">
        <div className="mb-8 lg:mb-[2.222vw] flex justify-center">
          <Link
            href="/"
            className="font-sebenta text-xl lg:text-[1.389vw] font-bold tracking-tight text-foreground"
            aria-label="MakingFlow home"
          >
            <SVGIcon
              src="/logo/logo.svg"
              preserveColors
              className="size-8 lg:size-[2.222vw] rounded lg:rounded-[0.324vw]"
            />
          </Link>
        </div>

        <div className="rounded-lg lg:rounded-[0.694vw] bg-background p-6 lg:p-[1.667vw] sm:p-7">
          <div className="mb-6 lg:mb-[1.667vw] space-y-1.5 lg:space-y-[0.417vw] text-center">
            <h1 className="text-xl lg:text-[1.389vw] font-semibold tracking-tight text-foreground">
              {title}
            </h1>
            {subtitle ? (
              <p className="text-sm lg:text-[0.972vw] text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          {children}
        </div>

        {footer ? (
          <p className="mt-6 lg:mt-[1.667vw] text-center text-sm lg:text-[0.972vw] text-muted-foreground">
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
      className="mb-4 lg:mb-[1.111vw] rounded-md lg:rounded-[0.556vw] border border-destructive/30 bg-destructive/5 px-3 lg:px-[0.833vw] py-2 lg:py-[0.556vw] text-sm lg:text-[0.972vw] text-destructive"
    >
      {message}
    </p>
  );
}

/** Labelled rule, e.g. "or". */
export function AuthDivider({ label }: { label: string }) {
  return (
    <div className="relative my-5 lg:my-[1.389vw]">
      <div className="absolute inset-0 flex items-center" aria-hidden>
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-background px-3 lg:px-[0.833vw] text-xs lg:text-[0.833vw] text-muted-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}
