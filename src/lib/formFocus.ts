// Surfaces the first native-invalid field on a blocked submit so mobile users
// aren't left scrolling to find what's missing.
export function focusFirstInvalidField(form: HTMLFormElement) {
  const el = form.querySelector<HTMLElement>(":invalid")
  if (!el) return
  el.scrollIntoView({ behavior: "smooth", block: "center" })
  el.focus()
}
