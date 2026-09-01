"use server"

/**
 * Workspace lifecycle: create, switch, rename, delete, leave, branding.
 *
 * Separate from ./team.ts, which is about the PEOPLE in a workspace. The split
 * matters beyond tidiness: every action here takes an explicit `workspaceId` and
 * gates on it (`requireMember` / `requireWorkspaceOwner`), while every action in
 * team.ts gates on whichever workspace is currently active (`requireOwner`).
 * Mixing the two conventions in one file is how an edit picks the wrong gate and
 * mutates the wrong tenant.
 */

import { cookies } from "next/headers"
import { revalidatePath, updateTag } from "next/cache"
import { after } from "next/server"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "@/lib/db"
import { workspaceMembers, workspaces } from "@/lib/db/schema"
import {
  getDefaultWorkspace,
  getMyWorkspaces,
  getRequiredUser,
} from "@/lib/auth/session"
import { setActiveWorkspaceCookie } from "@/lib/auth/active-workspace"
import { requireMember, requireWorkspaceOwner } from "@/lib/auth/permissions"
import { getOwnerCount } from "@/lib/data/team"
import { withSlugRetry } from "@/lib/workspaces/slug"
import { collectWorkspaceAssets } from "@/lib/workspaces/assets"
import { assetFromUrl, destroyAssets } from "@/lib/cloudinary/delete"
import { isCloudinaryUrl } from "@/lib/cloudinary/url"
import { vercelRemoveDomain } from "@/lib/domains/vercel"

type Result = { success: true } | { success: false; error: string }
type CreateResult = { success: true; workspaceId: string } | { success: false; error: string }
/** `nextWorkspaceId` is where the client should land — the caller's page is
 *  describing a workspace that just stopped existing (or stopped being theirs). */
type ExitResult = { success: true; nextWorkspaceId: string } | { success: false; error: string }

const nameSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, " ").slice(0, 60))
  .refine((s) => s.length >= 2, "Use at least 2 characters")

/** Switch the caller's active workspace (validated against their memberships). */
export async function switchWorkspace(workspaceId: string): Promise<Result> {
  const gate = await requireMember(workspaceId)
  if (!gate.workspace) return { success: false, error: "Not a member of that workspace" }

  const store = await cookies()
  setActiveWorkspaceCookie(store, workspaceId)
  revalidatePath("/", "layout")
  return { success: true }
}

/**
 * Create a workspace and make it active.
 *
 * Gated on being signed in and nothing else — there is no active workspace to be
 * an owner of yet, so the owner gates would be the wrong question. Mirrors the
 * transaction in `provisionUser`: the workspace and its owner membership are one
 * unit, because a workspace nobody belongs to is invisible and unreachable.
 */
export async function createWorkspace(nameRaw: string): Promise<CreateResult> {
  const user = await getRequiredUser()

  const parsed = nameSchema.safeParse(nameRaw)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Enter a workspace name." }
  }
  const name = parsed.data

  let workspaceId: string
  try {
    workspaceId = await withSlugRetry(name, (slug) =>
      db.transaction(async (tx) => {
        const [workspace] = await tx
          .insert(workspaces)
          .values({ name, slug, createdById: user.id })
          .returning({ id: workspaces.id })

        await tx.insert(workspaceMembers).values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "owner",
        })
        return workspace.id
      }),
    )
  } catch (err) {
    console.error("[createWorkspace] failed", err)
    return { success: false, error: "Couldn't create the workspace. Please try again." }
  }

  // You just made it — you expect to be in it.
  const store = await cookies()
  setActiveWorkspaceCookie(store, workspaceId)
  // The name and logo show in the sidebar footer and account menu on every page.
  revalidatePath("/", "layout")
  return { success: true, workspaceId }
}

/**
 * Rename a workspace. Owner-only.
 *
 * The slug is regenerated alongside the name because it is shown directly under
 * it in Settings, and a workspace called "Figmenta" sitting above
 * `/haseeb-s-workspace-5748bf` reads as a bug. Nothing routes or looks up on the
 * slug — it is display only — so changing it breaks no links.
 */
export async function renameWorkspace(nameRaw: string, workspaceId?: string): Promise<Result> {
  // Defaults to the active workspace so the existing inline-rename call site
  // keeps working unchanged.
  const targetId = workspaceId ?? (await getDefaultWorkspace())?.id
  if (!targetId) return { success: false, error: "No workspace" }

  const gate = await requireWorkspaceOwner(targetId, "update_workspace")
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }

  const parsed = nameSchema.safeParse(nameRaw)
  if (!parsed.success) return { success: false, error: "Enter a workspace name." }
  const name = parsed.data

  try {
    await withSlugRetry(name, (slug) =>
      db.update(workspaces).set({ name, slug }).where(eq(workspaces.id, targetId)),
    )
  } catch (err) {
    console.error("[renameWorkspace] failed", err)
    return { success: false, error: "Couldn't rename the workspace. Please try again." }
  }

  revalidatePath("/", "layout")
  return { success: true }
}

/**
 * Permanently delete a workspace and everything in it. Owner-only.
 *
 * Guarded three ways, all server-side regardless of what the UI allows: you must
 * own it, it must not be your last one, and you must retype its name.
 */
export async function deleteWorkspace(
  workspaceId: string,
  confirmName: string,
): Promise<ExitResult> {
  const gate = await requireWorkspaceOwner(workspaceId, "delete_workspace")
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }

  const mine = await getMyWorkspaces()
  if (mine.length <= 1) {
    return { success: false, error: "This is your only workspace. Create another one first." }
  }
  if (confirmName.trim() !== gate.workspace.name) {
    return { success: false, error: "The name doesn't match." }
  }

  const active = await getDefaultWorkspace()
  const fallback = mine.find((w) => w.id !== workspaceId)
  if (!fallback) return { success: false, error: "This is your only workspace." }

  // Collect BEFORE the delete: the cascade takes the rows holding the Cloudinary
  // public_ids with it, and there is no recovering them afterwards.
  const { assets, forms: formRows, domains } = await collectWorkspaceAssets(workspaceId)

  // Deregister custom domains from Vercel first, best-effort. Deliberately
  // unlike removeCustomDomain, which treats a Vercel failure as fatal: blocking
  // a deletion the user is entitled to on a third-party outage is worse than
  // leaking a registration, which we can clean up later from the logs.
  for (const d of domains) {
    try {
      await vercelRemoveDomain(d.domain)
    } catch (err) {
      console.error(`[deleteWorkspace] vercel removal failed for ${d.domain}`, err)
    }
  }

  try {
    // One statement. Every FK referencing workspaces is ON DELETE CASCADE:
    // members, invitations, connections, domains, usage, folders, forms (and
    // their fields/translations/chat/events/integrations), submissions (and
    // their answers), and uploads.
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId))
  } catch (err) {
    console.error("[deleteWorkspace] failed", err)
    return { success: false, error: "Couldn't delete the workspace. Please try again." }
  }

  // Only move the user if the ground moved under them. Deleting a workspace
  // from the list while sitting in a different one must not relocate them.
  const nextWorkspaceId = active?.id === workspaceId ? fallback.id : (active?.id ?? fallback.id)
  if (active?.id === workspaceId) {
    setActiveWorkspaceCookie(await cookies(), fallback.id)
  }

  // Off the request path — a Cloudinary outage must never fail a delete that
  // already committed.
  if (assets.length > 0) after(async () => destroyAssets(assets))

  updateTag(`workspace-forms-${workspaceId}`)
  updateTag(`workspace-domains-${workspaceId}`)
  // Without this the PUBLIC runtime keeps serving a deleted tenant's forms from
  // cache: loadFormDef tags each one `form-${id}` inside its cached scope.
  for (const f of formRows) updateTag(`form-${f.id}`)
  revalidatePath("/", "layout")
  return { success: true, nextWorkspaceId }
}

/**
 * Leave a workspace you were invited to.
 *
 * An owner may leave only if someone else owns it too — the same
 * "keep at least one owner" rule that `removeMember` enforces, applied to
 * yourself. A sole owner's exit is `deleteWorkspace`, or handing ownership over
 * first.
 */
export async function leaveWorkspace(workspaceId: string): Promise<ExitResult> {
  const user = await getRequiredUser()
  const gate = await requireMember(workspaceId)
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }

  const mine = await getMyWorkspaces()
  if (mine.length <= 1) {
    return { success: false, error: "You can't leave your only workspace." }
  }
  const fallback = mine.find((w) => w.id !== workspaceId)
  if (!fallback) return { success: false, error: "You can't leave your only workspace." }

  if (gate.workspace.role === "owner" && (await getOwnerCount(workspaceId)) <= 1) {
    return {
      success: false,
      error: "Transfer ownership to another member, or delete the workspace instead.",
    }
  }

  const active = await getDefaultWorkspace()

  await db
    .delete(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)),
    )

  const nextWorkspaceId = active?.id === workspaceId ? fallback.id : (active?.id ?? fallback.id)
  if (active?.id === workspaceId) {
    setActiveWorkspaceCookie(await cookies(), fallback.id)
  }

  // No updateTag here: the workspace and its cached data still exist for
  // everyone still in it, and flushing their tags would punish them for your
  // departure.
  revalidatePath("/", "layout")
  return { success: true, nextWorkspaceId }
}

/**
 * Set, replace, or remove a workspace's logo. Owner-only.
 *
 * `url` is whatever the browser posted: uploads go straight from the client to
 * an unsigned Cloudinary preset, so nothing about this string has passed through
 * us before now. It ends up as an `<img src>` in the sidebar of every page for
 * every member, which is why `isCloudinaryUrl` is not optional.
 */
export async function setWorkspaceLogo(
  workspaceId: string,
  url: string | null,
): Promise<Result> {
  const gate = await requireWorkspaceOwner(workspaceId, "update_workspace")
  if (!gate.workspace) return { success: false, error: gate.error ?? "Not authorized" }

  if (url !== null && !isCloudinaryUrl(url)) {
    return { success: false, error: "That image couldn't be verified." }
  }

  const previous = gate.workspace.logoUrl

  try {
    await db.update(workspaces).set({ logoUrl: url }).where(eq(workspaces.id, workspaceId))
  } catch (err) {
    console.error("[setWorkspaceLogo] failed", err)
    return { success: false, error: "Couldn't update the logo. Please try again." }
  }

  // Covers replace and remove through one path: whatever was there is now
  // unreferenced.
  if (previous && previous !== url) {
    const stale = assetFromUrl(previous)
    if (stale) after(async () => destroyAssets([stale]))
  }

  revalidatePath("/", "layout")
  return { success: true }
}
