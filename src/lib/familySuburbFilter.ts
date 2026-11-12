// Families-list suburb filter (OSS-39). Family.suburb is encrypted with a random
// IV, so it cannot be matched in SQL. Rows written since OSS-39 carry
// `suburbHash` (hmacSuburb of the normalised suburb), so the filter is an
// indexed equality lookup. Rows written before it (suburbHash null) are matched
// by decrypting them, bounded by LEGACY_SUBURB_SCAN_CAP; once
// `scripts/backfill-suburb-hash.ts` has run, that set is empty and no row is
// decrypted to filter.
import { hmacSuburb, normaliseSuburb, safeDecrypt } from "@/lib/crypto"
import type { Prisma } from "@/lib/generated/prisma/client"

/** Most families the list shows at once. */
export const FAMILY_CAP = 500

/** Most not-yet-backfilled (suburbHash null) families decrypted per suburb search. */
export const LEGACY_SUBURB_SCAN_CAP = 2000

/** Loads families matching `where`, ordered by name, at most `take` rows. */
export type FamilyFetcher<T extends { name: string; suburb: string | null }> = (
  where: Prisma.FamilyWhereInput,
  take: number,
) => Promise<T[]>

/** Result of a suburb-filtered family search. */
export type SuburbFilterResult<T> = {
  /** Matches with `suburb` decrypted, sorted by name, at most FAMILY_CAP. */
  families: T[]
  /** More than FAMILY_CAP families matched. */
  capped: boolean
  /** The legacy decrypt fallback hit its cap, so some unhashed rows were never checked. */
  scanIncomplete: boolean
}

/**
 * Find families whose suburb equals `suburb` after case/whitespace folding
 * (see normaliseSuburb). Exact match, not substring: "Sydney" does not match
 * "North Sydney".
 *
 * @param fetch - runs the Prisma query (where + take); must select `suburb` and `name`
 * @param baseWhere - the other active filters (archived, name, status)
 * @param suburb - the suburb typed by the user; must be non-blank
 * @returns matches with decrypted suburbs, plus cap flags for the banners
 */
export async function findFamiliesBySuburb<T extends { name: string; suburb: string | null }>(
  fetch: FamilyFetcher<T>,
  baseWhere: Prisma.FamilyWhereInput,
  suburb: string,
): Promise<SuburbFilterResult<T>> {
  const wanted = normaliseSuburb(suburb)
  const [hashed, legacy] = await Promise.all([
    fetch({ ...baseWhere, suburbHash: hmacSuburb(suburb) }, FAMILY_CAP + 1),
    fetch({ ...baseWhere, suburbHash: null, suburb: { not: null } }, LEGACY_SUBURB_SCAN_CAP + 1),
  ])
  const decrypt = (f: T): T => ({ ...f, suburb: f.suburb ? safeDecrypt(f.suburb) : null })
  const legacyMatches = legacy
    .slice(0, LEGACY_SUBURB_SCAN_CAP)
    .map(decrypt)
    .filter((f) => normaliseSuburb(f.suburb ?? "") === wanted)
  const all = hashed.map(decrypt)
  // Keep the DB's name order when there is nothing to merge (the usual case
  // after the backfill); otherwise re-sort the merged list by name.
  if (legacyMatches.length > 0) {
    all.push(...legacyMatches)
    all.sort((a, b) => a.name.localeCompare(b.name))
  }
  return {
    families: all.slice(0, FAMILY_CAP),
    capped: all.length > FAMILY_CAP,
    scanIncomplete: legacy.length > LEGACY_SUBURB_SCAN_CAP,
  }
}
