"use client"

import { useActionState } from "react"

type Feedback = { error?: string | null; success?: string | null } | undefined

type Wrapped<R> = { result: R; values?: Record<string, string> }

/**
 * Drop-in replacement for `useActionState(action, undefined)` on settings forms.
 *
 * React 19 resets uncontrolled inputs to their `defaultValue` after every form
 * action, including ones that return `{ error }`, so a rejected value would
 * snap back to the saved one. This hook snapshots the submitted text fields
 * when the action returns an error and exposes them via `keep` / `keepChecked`
 * so inputs can use `defaultValue={keep("name", saved)}`. On success (or before
 * any submit) the saved value wins, so revalidated props still apply.
 *
 * Values live only in client state and are never sent anywhere; do not use it
 * for secret fields (file entries are skipped).
 *
 * @param action Server action with the `(prev, formData)` signature.
 * @returns `[result, formAction, isPending, keep, keepChecked]`.
 */
export function useKeepFormValues<R extends Feedback>(
  action: (prev: R, formData: FormData) => Promise<R>,
) {
  const [state, formAction, isPending] = useActionState<Wrapped<R> | undefined, FormData>(
    async (prev, formData) => {
      const result = await action(prev?.result as R, formData)
      if (!result?.error) return { result }
      const values: Record<string, string> = {}
      formData.forEach((v, k) => {
        if (typeof v === "string") values[k] = v
      })
      return { result, values }
    },
    undefined,
  )
  const values = state?.values

  /** Submitted text value after an error, otherwise the saved value. */
  const keep = <T extends string | number | null | undefined>(name: string, saved: T): string | T =>
    values && name in values ? values[name] : saved

  /** Submitted checkbox state after an error, otherwise the saved state. */
  const keepChecked = (name: string, saved: boolean): boolean => (values ? name in values : saved)

  return [state?.result, formAction, isPending, keep, keepChecked] as const
}
