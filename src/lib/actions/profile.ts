"use server"

import { eq } from "drizzle-orm"
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { db } from "@/lib/db"
import { users } from "@/lib/db/schema"
import { getRequiredUser } from "@/lib/auth/session"
import { createClient } from "@/lib/supabase/server"

type Result = { success: true } | { success: false; error: string }

const nameSchema = z.string().trim().min(2, "Use at least 2 characters").max(80)

/** Update the signed-in user's display name (our `users` row is the SSOT the
 *  session reads; we mirror it into Supabase auth metadata for consistency). */
export async function updateProfile(nameRaw: string): Promise<Result> {
  const user = await getRequiredUser()

  const parsed = nameSchema.safeParse(nameRaw)
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid name." }
  }
  const name = parsed.data

  await db.update(users).set({ name }).where(eq(users.id, user.id))

  // Best-effort mirror into auth metadata — never block the save on it.
  try {
    const supabase = await createClient()
    await supabase.auth.updateUser({ data: { name } })
  } catch (err) {
    console.error("[updateProfile] auth metadata sync failed", err)
  }

  revalidatePath("/", "layout")
  return { success: true }
}
