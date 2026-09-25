import { prisma } from "@/lib/prisma"
import {
  DEFAULT_RECEIPT_SETTINGS,
  KEY_TO_FIELD,
  RECEIPT_SETTING_KEYS,
  type ReceiptSettingKey,
  type ReceiptSettings,
} from "@/lib/receiptSettingsShared"

// Re-export the pure config so existing server importers keep working. Client
// components must import from ./receiptSettingsShared to avoid bundling prisma.
// (KEY_TO_FIELD stays internal — used only by getReceiptSettings below.)
export {
  DEFAULT_RECEIPT_SETTINGS,
  type ReceiptSettings,
}

// Auth-free reader (no "use server"/auth) so the PDF route + email path import
// it without pulling next-auth into node tests. Per-field fallback to defaults
// on missing/blank/error — a receipt send never breaks on a fresh/errored DB.
export async function getReceiptSettings(): Promise<ReceiptSettings> {
  const out: ReceiptSettings = { ...DEFAULT_RECEIPT_SETTINGS }
  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: RECEIPT_SETTING_KEYS as unknown as string[] } },
    })
    for (const row of rows) {
      const field = KEY_TO_FIELD[row.key as ReceiptSettingKey]
      if (field && row.value && row.value.trim()) out[field] = row.value
    }
  } catch {
    return { ...DEFAULT_RECEIPT_SETTINGS }
  }
  return out
}
