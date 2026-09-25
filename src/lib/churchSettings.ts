import { unstable_cache } from "next/cache"
import type { AppSetting } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"
import { DEFAULT_CHURCH_NAME } from "@/lib/settingsConstants"

// Plain server module (NOT "use server") so getChurchSettings is a normal
// function call, not a client-callable RPC endpoint. Callers are all
// authenticated server contexts (receipt sends, DGR receipts, birthday sends).

const CHURCH_SETTING_KEYS = ["churchName", "churchAddress", "churchABN", "churchEmail", "churchWebsite"]

const readChurchSettingRows = () =>
  prisma.appSetting.findMany({ where: { key: { in: CHURCH_SETTING_KEYS } } })

// Church settings change a few times a year. Cache the pure DB read (1h TTL) and bust
// it via revalidateTag("church-settings") in updateChurchInfo so sends don't hit the DB
// on every receipt. Only the DB fetch is cached — process.env fallbacks stay per-request.
const getChurchSettingRows = unstable_cache(readChurchSettingRows, ["church-settings"], {
  tags: ["church-settings"],
  revalidate: 3600,
})

export type ChurchSettings = {
  name: string
  address: string
  abn: string
  email: string
  website: string
}

function toSettings(rows: AppSetting[]): ChurchSettings {
  const find = (key: string) => rows.find((r) => r.key === key)
  const get = (key: string, fallback: string) => find(key)?.value || fallback
  // churchWebsite: an explicitly-saved row wins over the env fallback even when
  // its value is blank, so an admin clearing the Website field ("leave blank to
  // hide it") actually hides the public membership/family-update links even when
  // CHURCH_WEBSITE is set in the environment. Env is the default only when no row
  // has ever been saved. The other keys keep blank→env-fallback, matching
  // the documented churchEmail behaviour.
  const websiteRow = find("churchWebsite")
  return {
    name: get("churchName", process.env.CHURCH_NAME ?? DEFAULT_CHURCH_NAME),
    address: get("churchAddress", process.env.CHURCH_ADDRESS ?? ""),
    abn: get("churchABN", process.env.CHURCH_ABN ?? ""),
    email: get("churchEmail", process.env.GMAIL_USER ?? ""),
    website: websiteRow ? websiteRow.value : (process.env.CHURCH_WEBSITE ?? ""),
  }
}

// Lenient read — for display surfaces. Several public, unauthenticated pages
// (privacy, event success, membership, family self-update) and site chrome read
// these settings. A DB outage / cache miss while the DB is down must not 500
// those pages — fall back to env + neutral defaults for this request. The throw
// is NOT cached (unstable_cache only caches a resolved value), so recovery is
// automatic once the DB returns.
export async function getChurchSettings(): Promise<ChurchSettings> {
  let rows: AppSetting[] = []
  try {
    rows = await getChurchSettingRows()
  } catch (err) {
    logger.error("[churchSettings] DB read failed — using env/default fallback", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return toSettings(rows)
}

// Strict read — for official financial documents (donation receipts, DGR tax
// receipts + their PDFs). These MUST carry the real church name, address and ABN
// (a DGR receipt with a placeholder ABN is not a valid tax receipt). Two ways a
// receipt could otherwise be issued with placeholder identity, both blocked here
//:
//   1. Transient DB error — getChurchSettingRows() rejects; we let it propagate
//      so the caller aborts and retries rather than falling back to env/neutral.
//   2. DB success but unconfigured identity — a fresh/partial deployment has no
//      churchName/address/ABN row or env value, so toSettings() returns the
//      neutral name and blank address/ABN. Validate after conversion and throw
//      so the operator configures Settings before any receipt goes out.
export async function getChurchSettingsStrict(): Promise<ChurchSettings> {
  // Read the DB DIRECTLY, bypassing the SWR cache (getChurchSettingRows): the
  // "church-settings" tag is invalidated with the "max" stale-while-revalidate
  // profile, so a cached read right after updateChurchInfo can still serve the
  // previous name/address/ABN while it refreshes in the background. A financial
  // document must carry the CURRENT legal identity, so strict mode never reads
  // through that cache.
  const settings = toSettings(await readChurchSettingRows())
  // Trim before validating — a saved value of only spaces is as blank on a
  // receipt as an empty string, and the settings schema doesn't require
  // non-whitespace content.
  const missing: string[] = []
  const name = settings.name.trim()
  if (!name || name === DEFAULT_CHURCH_NAME) missing.push("name")
  if (!settings.address.trim()) missing.push("address")
  if (!settings.abn.trim()) missing.push("ABN")
  if (missing.length > 0) {
    throw new Error(
      `Church ${missing.join(", ")} not configured — set church details in Settings before issuing receipts.`
    )
  }
  return settings
}

export type ChurchSettingsResult = { church: ChurchSettings } | { error: string }

// Action-boundary variant of getChurchSettingsStrict for the receipt server
// actions (sendSingleReceipt/sendBatchReceipts/sendDgrReceipt). It converts the
// two strict-mode failures into a typed { error } the actions can return
// verbatim, so the operator sees the actionable "set church details" message
// instead of a generic "Something went wrong" (single/DGR) or an uncaught
// rejection (batch) —. A transient DB error stays generic (no internals
// leaked) and is retryable. The DGR PDF *route* keeps calling the throwing
// getChurchSettingsStrict directly (a 500 is the right outcome there).
export async function getChurchSettingsForReceipt(): Promise<ChurchSettingsResult> {
  try {
    return { church: await getChurchSettingsStrict() }
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("not configured")
      ? e.message
      : "Couldn't load church details — please try again."
    return { error: msg }
  }
}
