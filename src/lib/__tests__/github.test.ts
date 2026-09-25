// src/lib/__tests__/github.test.ts
/** @jest-environment node */
import { listOpenIssuesByLabel } from "@/lib/github"

// Minimal Response stub with a Link header, matching what listOpenIssuesByLabel reads.
function page(
  issues: { number: number; body: string | null }[],
  link: string | null = null
): Response {
  return {
    ok: true,
    json: async () => issues,
    headers: { get: (k: string) => (k.toLowerCase() === "link" ? link : null) },
  } as unknown as Response
}

describe("listOpenIssuesByLabel", () => {
  const OLD = { ...process.env }
  beforeEach(() => {
    process.env.GITHUB_TOKEN = "t"
    process.env.GITHUB_REPO = "o/r"
  })
  afterEach(() => { process.env = { ...OLD }; jest.restoreAllMocks() })

  it("returns number + body for each open labelled issue", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(page([{ number: 12, body: "<!-- fingerprint:abc -->" }]))
    const out = await listOpenIssuesByLabel("prod-error")
    expect(out).toEqual([{ number: 12, body: "<!-- fingerprint:abc -->" }])
  })

  it("follows Link rel=next across pages so issues past page 1 are returned", async () => {
    const p2 = "https://api.github.com/repos/o/r/issues?page=2"
    const fetchMock = jest.spyOn(global, "fetch").mockImplementation(async (input) => {
      return input === p2
        ? page([{ number: 2, body: "b" }]) // page 2: no Link → last page
        : page([{ number: 1, body: "a" }], `<${p2}>; rel="next", <...>; rel="last"`)
    })
    fetchMock.mockClear() // spyOn reuses a mock left un-restored by a prior test — zero its history
    const out = await listOpenIssuesByLabel("prod-error")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe(p2)
    expect(out).toEqual([{ number: 1, body: "a" }, { number: 2, body: "b" }])
  })

  it("coerces a null body to an empty string", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(page([{ number: 9, body: null }]))
    const out = await listOpenIssuesByLabel("prod-error")
    expect(out).toEqual([{ number: 9, body: "" }])
  })
})
