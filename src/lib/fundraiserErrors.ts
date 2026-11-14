/**
 * Fundraiser error strings shared by the server action and client components.
 * Lives outside the "use server" action module so the client can import the value.
 */

/** Server error for a reused submission key with different details (see `recordPayment`). */
export const ALREADY_RECORDED_ERROR = "This payment was already recorded with different details. Reload to see it."
