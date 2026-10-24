/** @jest-environment node */
const mockAuth = jest.fn()

// React's real `cache()` only memoises inside a server request, so stand in a
// memoising version: the test then proves getSession is wrapped in cache().
jest.mock("react", () => ({
  ...jest.requireActual("react"),
  cache: <T extends (...a: never[]) => unknown>(fn: T) => {
    let hit = false
    let value: unknown
    return (() => {
      if (!hit) {
        value = fn()
        hit = true
      }
      return value
    }) as unknown as T
  },
}))
jest.mock("next-auth", () => ({
  __esModule: true,
  default: jest.fn(() => ({ auth: () => mockAuth(), handlers: {}, signOut: jest.fn() })),
  CredentialsSignin: class extends Error {},
}))
jest.mock("next-auth/providers/credentials", () => ({ __esModule: true, default: jest.fn((o: unknown) => o) }))
jest.mock("@/auth.config", () => ({ authConfig: {} }))
jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("@/lib/otp", () => ({}))
jest.mock("@/lib/notifications", () => ({}))
jest.mock("@/lib/audit", () => ({}))
jest.mock("@/lib/dbRateLimit", () => ({}))
jest.mock("@/lib/webauthn", () => ({}))
jest.mock("@simplewebauthn/server", () => ({}))

import { getSession } from "@/auth"

it("getSession is cache()-wrapped: repeated reads decode the session once", async () => {
  mockAuth.mockResolvedValue({ user: { role: "ADMIN" } })
  const [a, b] = await Promise.all([getSession(), getSession()])
  await getSession()
  expect(a).toBe(b)
  expect(mockAuth).toHaveBeenCalledTimes(1)
})
