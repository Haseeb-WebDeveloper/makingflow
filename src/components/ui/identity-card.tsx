import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { SVGIcon } from "./svg-icon";

// Compact "this is you" card: initials avatar + optional eyebrow + name +
// optional secondary line, with a signed-in check. Reusable wherever the app
// needs to surface the current/recognised user (post flow, confirmations, etc).
export function IdentityCard({
  name,
  secondary,
  eyebrow,
  verified = true,
  tone = "brand",
  className,
}: {
  name: string;
  secondary?: string;
  eyebrow?: string;
  verified?: boolean;
  /** "brand" = celebratory (post sign-in); "muted" = quiet, blends with a form. */
  tone?: "brand" | "muted";
  className?: string;
}) {
  const brand = tone === "brand";
  return (
    <div
      className={cn(
        "flex w-fit max-w-full items-center gap-3 lg:gap-[12px] rounded-md lg:rounded-[8px] border border-border bg-card px-4 lg:px-[16px] py-2.5 lg:py-[10px] text-left",
        className
      )}
    >
      <Avatar>
        <AvatarFallback
          className={cn(
            "font-semibold",
            brand
              ? "bg-secondary text-secondary-foreground"
              : "bg-muted text-foreground"
          )}
        >
          {initials(name)}
        </AvatarFallback>
      </Avatar>

      <div className="w-full min-w-0">
        {eyebrow && (
          <p className="text-[10px] lg:text-[10px] font-semibold uppercase tracking-wider text-foreground/45">
            {eyebrow}
          </p>
        )}
        <p className="truncate text-sm lg:text-[14px] font-semibold text-foreground">
          {name}
        </p>
        {secondary && (
          <p className="truncate text-[13px] lg:text-[13px] text-foreground/55">
            {secondary}
          </p>
        )}
      </div>

      {verified && (
        <span
          className={cn(
            "ml-1 lg:ml-[4px] flex size-5 lg:size-[20px] shrink-0 items-center justify-center rounded-full",
            brand
              ? "bg-secondary text-secondary-foreground"
              : "border border-border text-foreground/60"
          )}
        >
          <SVGIcon src="/icons/tick.svg" className="size-3 lg:size-[11px]" />
        </span>
      )}
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
