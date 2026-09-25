// duplicateWarning: set on a likely-duplicate manual transaction so the
// form can offer a "post anyway" resubmit instead of a plain dead-end error.
// negativeBalanceWarning: same soft-confirm UX for a petty-cash expense
// that would drive the session float below zero.
export type ActionResult = { error: string; duplicateWarning?: boolean; negativeBalanceWarning?: boolean } | undefined
export type ActionResultWithSuccess = { error: string } | { success: string } | undefined
