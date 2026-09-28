import { inlineScriptJson } from "@/lib/appConfig"

describe("inlineScriptJson", () => {
  it("escapes < so a value can't close the inline <script> tag", () => {
    const out = inlineScriptJson({ turnstileSiteKey: "</script><img src=x onerror=alert(1)>" })
    expect(out).not.toContain("<")
    expect(out).toContain(String.raw`\u003c/script>`)
  })

  it("round-trips to the original value when evaluated as JS", () => {
    const value = { a: "<b>", n: 3 }
    expect(JSON.parse(inlineScriptJson(value))).toEqual(value)
  })
})
