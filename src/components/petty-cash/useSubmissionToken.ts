"use client"

import { useRef } from "react"
import type { ActionResult } from "@/lib/actions/types"

/**
 * Builds a v4 UUID for the submission token. Prefers crypto.randomUUID (secure
 * contexts only) and falls back to crypto.getRandomValues, which also works on
 * plain-http self-hosted installs.
 */
export function newSubmissionToken(): string {
  const c = globalThis.crypto
  if (typeof c.randomUUID === "function") return c.randomUUID()
  const b = c.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

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
    tokenRef.current ??= newSubmissionToken()
    formData.set("submissionToken", tokenRef.current)
    return action(prev, formData)
  }
}
