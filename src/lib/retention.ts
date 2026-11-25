// ATO financial-record retention (extended to petty cash): the
// privacy page states a 7-year retention obligation that must hold regardless
// of the admin-configurable period-lock (an admin can move that date). This is
// a fixed floor (today minus 7 years) — a financial record dated inside the
// window can never be hard-deleted, by anyone. Shared by transaction.ts and
// pettyCash.ts so the floor and its wording stay identical across both
// delete paths (DRY).
const RETENTION_YEARS = 7

/**
 * Oldest date still inside the retention window: `now` minus 7 years.
 * @param now Reference instant (defaults to the current time; injectable for tests).
 */
export function retentionFloor(now: Date = new Date()): Date {
  const floor = new Date(now)
  floor.setFullYear(floor.getFullYear() - RETENTION_YEARS)
  return floor
}

/**
 * True when a record dated `date` is inside the retention window and so cannot be hard-deleted.
 * Single source for the server guards (`date >= retentionFloor()`) and the UI, so they never disagree.
 * @param date Record date.
 * @param now Reference instant (defaults to the current time).
 */
export function isWithinRetention(date: Date, now: Date = new Date()): boolean {
  return date >= retentionFloor(now)
}

/**
 * Server error for a blocked delete; ends with the correction path staff can use instead.
 * @param date Record date shown in the message.
 */
export function retentionError(date: Date): string {
  return `This transaction is dated ${date.toISOString().slice(0, 10)}, within the ${RETENTION_YEARS}-year financial record retention period required by the ATO. It cannot be deleted until the retention period has passed. Edit the entry to correct it.`
}
