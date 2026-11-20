import { escapeHtml } from "@/lib/escapeHtml"

describe("escapeHtml", () => {
  it("escapes the five special characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;")
  })

  it("escapes ampersands first so entities are not double-decoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;")
  })

  it("leaves plain text and the empty string unchanged", () => {
    expect(escapeHtml("Hello, world 1 2 3")).toBe("Hello, world 1 2 3")
    expect(escapeHtml("")).toBe("")
  })
})
