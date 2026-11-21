// duplicateWarning: set on a likely-duplicate manual transaction so the
// form can offer a "post anyway" resubmit instead of a plain dead-end error.
// negativeBalanceWarning: same soft-confirm UX for a petty-cash expense
// that would drive the session float below zero.
export type ActionResult = { error: string; duplicateWarning?: boolean; negativeBalanceWarning?: boolean } | undefined
// warning: optional caveat on a success (e.g. saved, but a roster clash needs action), rendered as a warning not green.
export type ActionResultWithSuccess = { error: string } | { success: string; warning?: string } | undefined
