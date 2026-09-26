// Shared "which payment account is this report/page showing" fallback chain,
// used by both the reconciliation report and the reconciliation working
// page: the account named in the URL, else the first BANK account, else the
// first account of any kind, else null (no accounts configured at all).
export function pickDefaultAccount<T extends { id: number; kind: string }>(
  accounts: T[],
  requestedId: number
): T | null {
  return accounts.find((a) => a.id === requestedId) ?? accounts.find((a) => a.kind === "BANK") ?? accounts[0] ?? null
}
