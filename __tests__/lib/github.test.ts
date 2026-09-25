/** @jest-environment node */

import { createIssue, getIssue } from "@/lib/github"

const realFetch = global.fetch

describe("createIssue", () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token"
    process.env.GITHUB_REPO = "owner/repo"
    global.fetch = jest.fn()
  })

  afterEach(() => {
    global.fetch = realFetch
    delete process.env.GITHUB_TOKEN
    delete process.env.GITHUB_REPO
  })

  it("posts to the repo issues endpoint and returns the issue number", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ number: 42 }),
    })

    const result = await createIssue({ title: "T", body: "B", labels: ["bug"] })

    expect(result).toEqual({ number: 42 })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe("https://api.github.com/repos/owner/repo/issues")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe("Bearer test-token")
    expect(init.headers.Accept).toBe("application/vnd.github+json")
    expect(JSON.parse(init.body)).toEqual({ title: "T", body: "B", labels: ["bug"] })
  })

  it("throws on a non-2xx response", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Bad credentials",
    })
    await expect(createIssue({ title: "T", body: "B" })).rejects.toThrow("GitHub issue creation failed: 401")
  })

  it("throws when GITHUB_TOKEN is missing", async () => {
    delete process.env.GITHUB_TOKEN
    await expect(createIssue({ title: "T", body: "B" })).rejects.toThrow("GITHUB_TOKEN")
  })

  it("throws when GITHUB_REPO is missing", async () => {
    delete process.env.GITHUB_REPO
    await expect(createIssue({ title: "T", body: "B" })).rejects.toThrow("GITHUB_REPO")
  })
})

describe("getIssue", () => {
  beforeEach(() => {
    process.env.GITHUB_TOKEN = "test-token"
    process.env.GITHUB_REPO = "owner/repo"
    global.fetch = jest.fn()
  })

  afterEach(() => {
    global.fetch = realFetch
    delete process.env.GITHUB_TOKEN
    delete process.env.GITHUB_REPO
  })

  it("gets the issue and returns its state and state_reason", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ number: 5, state: "closed", state_reason: "not_planned" }),
    })

    const result = await getIssue(5)

    expect(result).toEqual({ state: "closed", stateReason: "not_planned" })
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toBe("https://api.github.com/repos/owner/repo/issues/5")
    expect(init.method ?? "GET").toBe("GET")
    expect(init.headers.Authorization).toBe("Bearer test-token")
  })

  it("throws on a non-2xx response", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, text: async () => "Not Found" })
    await expect(getIssue(9)).rejects.toThrow("GitHub issue fetch failed: 404")
  })
})
