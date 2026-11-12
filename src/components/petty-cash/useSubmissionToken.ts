"use client"

import { useRef } from "react"
import { randomUuid } from "@/lib/randomUuid"
import type { ActionResult } from "@/lib/actions/types"

/**
 * Wraps a petty-cash create action so every submit carries one idempotency
 * token per mounted form (#491 transfers, #487 receipts/expenses). Not per
 * server render: lookup links can re-render the page client-side while the form
 * keeps its draft, so a page-made token could change mid-form. Made lazily on
 * first submit (no SSR/hydration mismatch) and reused by every later submit, so
 * a retry after a lost response is recognised server-side. Update actions
 * ignore the field.
 * @param action - the bound server action passed to useActionState
 * @returns the same action, with `submissionToken` set on its FormData
 */
export function useSubmissionToken(
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>,
): (prev: ActionResult, formData: FormData) => Promise<ActionResult> {
  const tokenRef = useRef<string | null>(null)
  return (prev, formData) => {
    tokenRef.current ??= randomUuid()
    formData.set("submissionToken", tokenRef.current)
    return action(prev, formData)
  }
}
