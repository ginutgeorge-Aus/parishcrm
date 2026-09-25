/**
 * @jest-environment jsdom
 */
import { focusFirstInvalidField } from "@/lib/formFocus"

function buildForm(inner: string): HTMLFormElement {
  const form = document.createElement("form")
  form.innerHTML = inner
  document.body.appendChild(form)
  return form
}

describe("focusFirstInvalidField", () => {
  afterEach(() => { document.body.innerHTML = "" })

  it("focuses and scrolls the first native-invalid field", () => {
    const form = buildForm(`
      <input id="a" required value="filled" />
      <input id="b" required value="" />
      <input id="c" required value="" />
    `)
    const b = form.querySelector<HTMLInputElement>("#b")!
    const scrollSpy = jest.fn()
    b.scrollIntoView = scrollSpy
    focusFirstInvalidField(form)
    expect(document.activeElement).toBe(b)
    expect(scrollSpy).toHaveBeenCalled()
  })

  it("does nothing when every field is valid", () => {
    const form = buildForm(`<input id="a" required value="filled" />`)
    const a = form.querySelector<HTMLInputElement>("#a")!
    focusFirstInvalidField(form)
    expect(document.activeElement).not.toBe(a)
  })
})
