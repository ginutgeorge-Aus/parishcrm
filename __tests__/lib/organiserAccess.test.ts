/** @jest-environment node */

// Isolate the /api/auth branch: force isPublicPath false so the only path that
// can allow an /api/auth* request is the explicit check under test.
jest.mock("@/lib/csp", () => ({ isPublicPath: jest.fn(() => false) }))

import { isOrganiserAllowedPath } from "@/lib/organiserAccess"

describe("isOrganiserAllowedPath — /api/auth prefix", () => {
  it("allows the NextAuth base and its subpaths", () => {
    expect(isOrganiserAllowedPath("/api/auth")).toBe(true)
    expect(isOrganiserAllowedPath("/api/auth/session")).toBe(true)
    expect(isOrganiserAllowedPath("/api/auth/callback/credentials")).toBe(true)
  })

  it("does NOT allow a different endpoint that merely starts with /api/auth", () => {
    // `/api/authorizations` is not a NextAuth route — the broad startsWith
    // matched it and let organisers through a non-auth API.
    expect(isOrganiserAllowedPath("/api/authorizations")).toBe(false)
    expect(isOrganiserAllowedPath("/api/authx")).toBe(false)
  })

  it("still allows /my-events and its subpaths", () => {
    expect(isOrganiserAllowedPath("/my-events")).toBe(true)
    expect(isOrganiserAllowedPath("/my-events/1")).toBe(true)
  })

  it("blocks an arbitrary dashboard path", () => {
    expect(isOrganiserAllowedPath("/families")).toBe(false)
  })
})
