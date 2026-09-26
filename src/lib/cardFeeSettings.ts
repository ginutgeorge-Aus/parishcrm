import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"

// Card fee rate changes when Stripe changes its pricing (e.g. 1 Oct 2026). Cache
// the DB read (1h) and bust via revalidateTag("card-fee") when settings save.
const getCardFeeRows = unstable_cache(
  () => prisma.appSetting.findMany({ where: { key: { in: ["cardFeePercent", "cardFeeFixed"] } } }),
  ["card-fee"],
  { tags: ["card-fee"], revalidate: 3600 },
)

// Returns the blended domestic rate as a percent + fixed cents. Falls back per
// field to the seeded default so checkout never breaks on a fresh/empty DB.
export async function getCardFeeConfig(): Promise<{ pct: number; fixedCents: number }> {
  const rows = await getCardFeeRows()
  // Clamp to the same bounds the write path enforces (NUMERIC_KEY_BOUNDS in
  // actions/settings.ts) so a value written before a future tightening — or via
  // a raw DB edit — can't gross up checkout against an out-of-range rate.
  const get = (key: string, fallback: number, max: number) => {
    const raw = rows.find((r) => r.key === key)?.value
    const n = raw != null ? Number(raw) : Number.NaN
    return Number.isFinite(n) && n >= 0 && n <= max ? n : fallback
  }
  return {
    pct: get("cardFeePercent", 1.7, 10),
    fixedCents: Math.round(get("cardFeeFixed", 0.3, 5) * 100),
  }
}
