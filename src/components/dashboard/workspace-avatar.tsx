import { OrbAvatar } from "@/components/ui/orb-avatar"
import { orbInitials } from "@/lib/avatar/orb"
import { cldDeliver } from "@/lib/cloudinary/url"
import { cn } from "@/lib/utils"

/**
 * A workspace's square: its logo when it has one, a generated tile when it
 * doesn't.
 *
 * Every surface that names a workspace shows this — the account-menu switcher,
 * the workspaces table, the settings header — and each one used to hand-roll the
 * same initial-letter span at a different size. The sizes here are the ones
 * those call sites already used, so nothing shifts.
 *
 * The fallback used to be one letter on a flat foreground square, which made
 * every logo-less workspace look identical in the switcher. It's now a colored
 * tile seeded off the workspace **id** — stable across renames, and distinct
 * between two workspaces that happen to share a name. The letter stays on top,
 * so nothing that was readable before became less so.
 *
 * Deliberately not a Client Component: it renders in server pages and in client
 * ones, and has no interactivity of its own.
 */

// Text sizes used to live here for the letter span; the generated tile draws
// its letter in viewBox units instead, so it scales with the square.
const SIZES = {
  xs: "size-6 rounded",
  sm: "size-7 rounded",
  md: "size-8 rounded",
  lg: "size-12 rounded-md",
} as const

export type WorkspaceAvatarSize = keyof typeof SIZES

export function WorkspaceAvatar({
  id,
  name,
  logoUrl,
  size = "md",
  className,
}: {
  /** The workspace id — the avatar's seed. */
  id: string
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

  return <OrbAvatar seed={id} label={orbInitials(name)} className={cn(shape, className)} />
}
