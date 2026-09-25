// ATO financial-record retention (extended to petty cash): the
// privacy page states a 7-year retention obligation that must hold regardless
// of the admin-configurable period-lock (an admin can move that date). This is
// a fixed floor (today minus 7 years) — a financial record dated inside the
// window can never be hard-deleted, by anyone. Shared by transaction.ts and
// pettyCash.ts so the floor and its wording stay identical across both
// delete paths (DRY).
const RETENTION_YEARS = 7

export function retentionFloor(): Date {
  const floor = new Date()
  floor.setFullYear(floor.getFullYear() - RETENTION_YEARS)
  return floor
}

export function retentionError(date: Date): string {
  return `This transaction is dated ${date.toISOString().slice(0, 10)}, within the ${RETENTION_YEARS}-year financial record retention period required by the ATO. It cannot be deleted until the retention period has passed.`
}
