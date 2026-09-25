/** @jest-environment node */
jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(() => { throw new Error("REDIRECT") }) }))
jest.mock("@/lib/actions/trustedDevice", () => ({ listTrustedDevices: jest.fn().mockResolvedValue([]) }))
jest.mock("@/components/account/TrustedDeviceList", () => ({ TrustedDeviceList: () => null }))

import { auth } from "@/auth"
import AccountPage from "@/app/(dashboard)/account/page"

it("redirects an unauthenticated visitor to /login", async () => {
  ;(auth as jest.Mock).mockResolvedValue(null)
  await expect(AccountPage()).rejects.toThrow("REDIRECT")
})

it("renders for an authenticated user", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
  const el = await AccountPage()
  expect(el).toBeTruthy()
})
