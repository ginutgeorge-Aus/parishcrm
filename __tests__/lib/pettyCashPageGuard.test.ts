jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOT_FOUND") }),
}))

import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { requirePettyCashSessionId } from "@/lib/pettyCashPageGuard"

const mockAuth = auth as unknown as jest.Mock

describe("requirePettyCashSessionId", () => {
  beforeEach(() => jest.clearAllMocks())

  it("returns the parsed id for an accounting user", async () => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    await expect(requirePettyCashSessionId("42")).resolves.toBe(42)
  })

  it("redirects non-accounting users before parsing the id", async () => {
    mockAuth.mockResolvedValue({ user: { role: "VIEWER" } })
    await expect(requirePettyCashSessionId("42")).rejects.toThrow("REDIRECT")
    expect(redirect).toHaveBeenCalledWith("/accounting/petty-cash")
  })

  it("redirects when there is no session", async () => {
    mockAuth.mockResolvedValue(null)
    await expect(requirePettyCashSessionId("42")).rejects.toThrow("REDIRECT")
  })

  it.each(["0", "abc", "1.5", "2147483648"])("404s on invalid id %p", async (raw) => {
    mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
    await expect(requirePettyCashSessionId(raw)).rejects.toThrow("NOT_FOUND")
  })
})
