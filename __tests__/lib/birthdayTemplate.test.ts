import { renderBirthdayEmail, DEFAULT_BIRTHDAY_TEMPLATE } from "@/lib/birthdayTemplate"
import { pronouns } from "@/lib/pronouns"

describe("renderBirthdayEmail", () => {
  it("substitutes firstName and pronouns in subject and body", () => {
    const out = renderBirthdayEmail(
      { subject: "Happy Birthday, {firstName}!", body: "Bless {them} and {their} family, {firstName}." },
      { firstName: "Jon", ...pronouns("MALE"), churchName: "Demo Church" },
    )
    expect(out.subject).toBe("Happy Birthday, Jon!")
    expect(out.text).toBe("Bless him and his family, Jon.")
    expect(out.html).toContain("Bless him and his family, Jon.")
  })

  it("escapes HTML in substituted values for the html output", () => {
    const out = renderBirthdayEmail(
      { subject: "Hi {firstName}", body: "Hi {firstName}" },
      { firstName: "<b>x</b>", ...pronouns("MALE"), churchName: "Demo Church" },
    )
    expect(out.html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(out.html).not.toContain("<b>x</b>")
    expect(out.text).toBe("Hi <b>x</b>") // text variant not escaped
  })

  it("converts body newlines to <br> in html", () => {
    const out = renderBirthdayEmail(
      { subject: "s", body: "line1\nline2" },
      { firstName: "A", ...pronouns("MALE"), churchName: "Demo Church" },
    )
    expect(out.html).toContain("line1<br>line2")
  })

  it("ships a greeting + blessing + signoff default with firstName + pronoun tokens", () => {
    expect(DEFAULT_BIRTHDAY_TEMPLATE.subject).toContain("{firstName}")
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).toContain("Dear {firstName}")
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).toContain("Happy Birthday")
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).toContain("{they}")
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).toContain("{them}")
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).toContain("{their}")
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).toContain("Amen.")
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body.trim().endsWith("{churchName}")).toBe(true)
  })

  it("does not cascade when a value contains another placeholder literal", () => {
    const out = renderBirthdayEmail(
      { subject: "Hi {firstName}", body: "Hi {firstName} — {they}" },
      { firstName: "{they}", ...pronouns("FEMALE"), churchName: "Demo Church" },
    )
    expect(out.text).toBe("Hi {they} — she")
  })

  it("default template carries no hardcoded church name", () => {
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).not.toMatch(/St\.? Mark/i)
    expect(DEFAULT_BIRTHDAY_TEMPLATE.body).toContain("{churchName}")
  })

  it("substitutes churchName", () => {
    const { text, html } = renderBirthdayEmail(DEFAULT_BIRTHDAY_TEMPLATE, {
      firstName: "Sam", they: "they", them: "them", their: "their",
      churchName: "Demo Church",
    })
    expect(text).toContain("Demo Church")
    expect(html).toContain("Demo Church")
    expect(text).not.toMatch(/St\.? Mark/i)
  })
})
