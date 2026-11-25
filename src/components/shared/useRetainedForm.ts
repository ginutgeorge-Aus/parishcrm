"use client"

import { startTransition, useActionState, useRef, type FormEvent } from "react"

type Wrapped<R> = { result: R; errorSeq: number }

const GENERIC_ERROR = "Something went wrong. Please try again."

type Feedback = { error?: string | null; success?: string | null } | undefined

/**
 * Drop-in replacement for `useActionState(action, undefined)` on forms whose
 * server action can reject a save with `{ error }`.
 *
 * React 19 resets a `<form action={fn}>` to its `defaultValue`s once the action
 * finishes, even when it only returned an error, so a rejected save empties
 * the form (or snaps dates and selects back to their starting values). This
 * hook submits through `onSubmit` + `startTransition` instead: the form is
 * never reset, so every typed value (text, date, Radix Select, checkbox, child
 * editors with their own state) stays exactly as the user left it. Pair it
 * with `<FormError error={state?.error} errorKey={errorSeq} />` to bring the
 * message into view on a phone.
 *
 * The submit button that triggered the form is included in the FormData, so
 * `<Button type="submit" name="confirmDuplicate" value="true">` keeps working.
 *
 * An action that throws is caught and shown as a generic error, so the form
 * and its input survive.
 *
 * A result without `error` (for example `{ success }`) still clears the form, as
 * React's own reset did before.
 *
 * Use it as `<form onSubmit={onSubmit}>`, not together with `action=`.
 *
 * @param action Server action with the `(prev, formData)` signature.
 * @returns `[state, onSubmit, isPending, errorSeq]`; `errorSeq` increases on
 *   every rejected save so an identical repeated message still re-focuses.
 */
export function useRetainedForm<R extends Feedback>(
  action: (prev: R, formData: FormData) => Promise<R>,
) {
  const formRef = useRef<HTMLFormElement | null>(null)
  const [wrapped, dispatch, isPending] = useActionState<Wrapped<R> | undefined, FormData>(
    async (prev, formData) => {
      let result: R
      try {
        result = await action(prev?.result as R, formData)
      } catch {
        // A thrown action (network drop, unexpected server error) must not unmount the form
        // via the error boundary and lose the user's input: surface it as a normal error.
        result = { error: GENERIC_ERROR } as R
      }
      // A non-error result (e.g. `{ success }`) keeps React's old behaviour: the form is cleared.
      if (!result?.error) formRef.current?.reset()
      return { result, errorSeq: (prev?.errorSeq ?? 0) + (result?.error ? 1 : 0) }
    },
    undefined,
  )

  /** Submits the form's FormData (incl. the clicked submit button) without letting React reset the form. */
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    formRef.current = e.currentTarget
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const data = new FormData(e.currentTarget, submitter)
    startTransition(() => dispatch(data))
  }

  return [wrapped?.result, onSubmit, isPending, wrapped?.errorSeq ?? 0] as const
}
