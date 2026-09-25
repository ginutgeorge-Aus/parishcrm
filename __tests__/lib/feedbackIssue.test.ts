import { escapeMarkdown, buildIssueTitle, buildIssueBody } from "@/lib/feedbackIssue"

describe("escapeMarkdown", () => {
  it("escapes markdown control characters", () => {
    expect(escapeMarkdown("a*b_c`d#e")).toBe("a\\*b\\_c\\`d\\#e")
  })

  it("escapes < so user text can't open or close HTML like </details>", () => {
    expect(escapeMarkdown("</details><b>")).toBe("\\</details\\>\\<b\\>")
  })
})

describe("buildIssueTitle", () => {
  it("prefixes and truncates to 70 code points without splitting a surrogate pair", () => {
    expect(buildIssueTitle("Bug", "boom")).toBe("Bug: boom")
    const long = "😀".repeat(80)
    const title = buildIssueTitle("Bug", long)
    expect([...title.replace("Bug: ", "")]).toHaveLength(70)
  })
})

describe("buildIssueBody", () => {
  it("emits lead lines then a technical-details block with escaped client fields", () => {
    const body = buildIssueBody({
      lead: ["**Feedback:** hi"],
      reporter: "Public visitor",
      type: "FEEDBACK",
      pageUrl: "/e/carols",
      client: { userAgent: "Chrome*1", language: "en-AU", viewport: "1280×720" },
      timestamp: "1 Jan 2026, 10:00 am (AEDT)",
    })
    expect(body).toContain("**Feedback:** hi")
    expect(body).toContain("<details><summary>Technical details</summary>")
    expect(body).toContain("- Reporter: Public visitor")
    expect(body).toContain("- Page: /e/carols")
    expect(body).toContain("- Browser: Chrome\\*1") // escaped
    expect(body).toContain("- Submitted: 1 Jan 2026, 10:00 am (AEDT)")
  })

  it("does not re-escape the caller-escaped reporter", () => {
    // Callers pass reporter already markdown-escaped; the module must embed it
    // verbatim, never double-escape it.
    const body = buildIssueBody({ lead: ["x"], reporter: "a*b", type: "BUG", timestamp: "t" })
    expect(body).toContain("- Reporter: a*b")
  })

  it("falls back to 'unknown' for a missing page and client", () => {
    const body = buildIssueBody({ lead: ["x"], reporter: "r", type: "BUG", timestamp: "t" })
    expect(body).toContain("- Page: unknown")
    expect(body).toContain("- Browser: unknown")
    expect(body).toContain("- Viewport: ? · Screen: ? · DPR: ?")
  })
})

describe("buildIssueBody — single-line technical fields", () => {
  it("keeps each untrusted client value on its own list line", () => {
    const body = buildIssueBody({
      lead: [],
      reporter: "r\n- Type: forged",
      type: "bug",
      pageUrl: "/x\r\n- Reporter: forged",
      client: { userAgent: "UA\n</details>\n- Type: forged", language: "en\nx", viewport: "1\n2", screen: "3\r4" },
      timestamp: "t",
    })
    const lines = body.split("\n")
    expect(lines.filter((l) => l.startsWith("- Reporter:"))).toEqual(["- Reporter: r - Type: forged"])
    expect(lines.filter((l) => l.startsWith("- Type:"))).toEqual(["- Type: bug"])
    expect(lines.filter((l) => l === "</details>")).toHaveLength(1)
    expect(body).not.toMatch(/\r/)
  })
})
