import { cldDeliver } from "@/lib/cloudinary/url"
import { cn } from "@/lib/utils"

/**
 * A workspace's square: its logo when it has one, its initial when it doesn't.
 *
 * Every surface that names a workspace shows this — the account-menu switcher,
 * the workspaces table, the settings header — and each one used to hand-roll the
 * same initial-letter span at a different size. The sizes here are the ones
 * those call sites already used, so nothing shifts.
 *
 * Deliberately not a Client Component: it renders in server pages and in client
 * ones, and has no interactivity of its own.
 */

const SIZES = {
  xs: "size-6 text-[10px] rounded",
  sm: "size-7 text-[11px] rounded",
  md: "size-8 text-xs rounded",
  lg: "size-12 text-lg rounded-md",
} as const

export type WorkspaceAvatarSize = keyof typeof SIZES

export function WorkspaceAvatar({
  name,
  logoUrl,
  size = "md",
  className,
}: {
  name: string
  logoUrl?: string | null
  size?: WorkspaceAvatarSize
  className?: string
}) {
  const shape = SIZES[size]

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={cldDeliver(logoUrl, "f_auto,q_auto,w_96,h_96,c_fill")}
        alt=""
        decoding="async"
        className={cn("shrink-0 object-cover", shape, className)}
      />
    )
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center bg-foreground font-semibold text-background",
        shape,
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
