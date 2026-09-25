"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"
import { actorId } from "@/lib/actor"
import { isAdmin } from "@/lib/roleGuard"
import { logAudit } from "@/lib/audit"
import {
  RECEIPT_SETTING_KEYS,
  RECEIPT_SETTING_MAX_LENGTHS,
  type ReceiptSettingKey,
} from "@/lib/receiptSettingsShared"

const KEY_SET = new Set<string>(RECEIPT_SETTING_KEYS)

const InputSchema = z
  .record(z.string(), z.string())
  .refine((o) => Object.keys(o).every((k) => KEY_SET.has(k)), "Unknown setting key")
  .refine(
    (o) =>
      Object.entries(o).every(
        ([k, v]) => v.length <= RECEIPT_SETTING_MAX_LENGTHS[k as ReceiptSettingKey]
      ),
    "A value exceeds its maximum length"
  )

export async function updateReceiptSettings(
  input: Record<string, string>
): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Not authorised" }

  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  await prisma.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(parsed.data)) {
      await tx.appSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      })
    }
  })
  await logAudit(actorId(session), "RECEIPT_SETTINGS_UPDATED", "AppSetting", undefined, {
    keys: Object.keys(parsed.data),
  })
  revalidatePath("/settings")
  return { ok: true }
}

export async function resetReceiptSettings(): Promise<{ ok: true } | { error: string }> {
  const session = await auth()
  if (!isAdmin(session?.user?.role)) return { error: "Not authorised" }

  await prisma.appSetting.deleteMany({
    where: { key: { in: Array.from(RECEIPT_SETTING_KEYS) } },
  })
  await logAudit(actorId(session), "RECEIPT_SETTINGS_RESET", "AppSetting", undefined, {
    keys: RECEIPT_SETTING_KEYS,
  })
  revalidatePath("/settings")
  return { ok: true }
}
