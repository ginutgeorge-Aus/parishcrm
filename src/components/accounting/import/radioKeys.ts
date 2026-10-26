import type { KeyboardEvent } from "react"

/**
 * onKeyDown for a `role="radiogroup"` container using roving tabindex: arrow keys
 * move focus to the previous/next enabled radio (wrapping) and select it, as
 * native radios do. Pair with `tabIndex={selected ? 0 : -1}` on each radio.
 */
export function radioGroupKeyDown(e: KeyboardEvent<HTMLElement>): void {
  const forward = e.key === "ArrowRight" || e.key === "ArrowDown"
  const back = e.key === "ArrowLeft" || e.key === "ArrowUp"
  if (!forward && !back) return
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)'))
  const i = radios.indexOf(document.activeElement as HTMLElement)
  if (i === -1) return
  e.preventDefault()
  const next = radios[(i + (forward ? 1 : -1) + radios.length) % radios.length]
  next.focus()
  next.click()
}
