import { renderAnniversaryEmail, DEFAULT_ANNIVERSARY_TEMPLATE } from "@/lib/anniversaryTemplate"

test("substitutes names + years, escapes HTML in names", () => {
  const out = renderAnniversaryEmail(DEFAULT_ANNIVERSARY_TEMPLATE, { names: "A & B", years: "6", churchName: "Demo Church" })
  expect(out.subject).toContain("A & B")
  expect(out.text).toContain("6 years")
  expect(out.html).toContain("A &amp; B")
})

test("default body has a greeting + blessing + signoff with both tokens", () => {
  expect(DEFAULT_ANNIVERSARY_TEMPLATE.body).toContain("Dear {names}")
  expect(DEFAULT_ANNIVERSARY_TEMPLATE.body).toContain("Happy Anniversary")
  expect(DEFAULT_ANNIVERSARY_TEMPLATE.body).toContain("Amen.")
  expect(DEFAULT_ANNIVERSARY_TEMPLATE.body).toContain("{names}")
  expect(DEFAULT_ANNIVERSARY_TEMPLATE.body).toContain("{years}")
  expect(DEFAULT_ANNIVERSARY_TEMPLATE.body).toContain("{churchName}")
})

test("default template carries no hardcoded church name", () => {
  expect(DEFAULT_ANNIVERSARY_TEMPLATE.body).not.toMatch(/St\.? Mark/i)
})

test("renderAnniversaryEmail substitutes churchName", () => {
  const { text, html } = renderAnniversaryEmail(DEFAULT_ANNIVERSARY_TEMPLATE, {
    names: "A and B", years: "6", churchName: "Demo Church",
  })
  expect(text).toContain("Demo Church")
  expect(html).toContain("Demo Church")
  expect(text).not.toMatch(/St\.? Mark/i)
})
