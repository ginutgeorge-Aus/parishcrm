/** Minimal shape `groupByAccountGroup` needs off each account row. */
type GroupedAccount = {
  group: { id: number; name: string; sortOrder: number } | null
}

export type AccountGroup<T extends GroupedAccount> = {
  groupName: string
  sortOrder: number
  accounts: T[]
}

/**
 * Bucket accounts by their `group.id`, sorted by `group.sortOrder`.
 * Ungrouped accounts collapse into a single "Other" group with sortOrder 999.
 * Generic over the account row so each report keeps its own row type.
 *
 * keying by `group.name` merged distinct groups whose display names
 * happened to collide — `AccountGroup`'s unique key is `(name, type)`, not
 * name alone, so two different groups (e.g. an income "Fundraising" and an
 * expense "Fundraising") can legitimately share a name. Key by id instead.
 */
export function groupByAccountGroup<T extends GroupedAccount>(accounts: T[]): AccountGroup<T>[] {
  const map = new Map<string, AccountGroup<T>>()
  for (const a of accounts) {
    const key = a.group ? `id:${a.group.id}` : "__ungrouped__"
    const sortOrder = a.group?.sortOrder ?? 999
    if (!map.has(key)) {
      map.set(key, { groupName: a.group?.name ?? "Other", sortOrder, accounts: [] })
    }
    map.get(key)!.accounts.push(a)
  }
  return Array.from(map.values()).sort((a, b) => a.sortOrder - b.sortOrder)
}
