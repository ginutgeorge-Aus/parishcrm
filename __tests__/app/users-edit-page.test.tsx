/** @jest-environment node */
import Page from "@/app/(dashboard)/users/[id]/edit/page"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("REDIRECT") }),
  notFound: jest.fn(() => { throw new Error("NOTFOUND") }),
}))
jest.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn() } } }))
jest.mock("@/lib/actions/user", () => ({ updateUser: jest.fn() }))
jest.mock("@/components/users/UserForm", () => ({ UserForm: () => null }))

beforeEach(() => { jest.clearAllMocks() })

it("redirects a non-manager role", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "VIEWER", id: "1" } })
  await expect(Page({ params: Promise.resolve({ id: "1" }) })).rejects.toThrow("REDIRECT")
})

it("renders for ADMIN", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 2, name: "Jane", role: "OFFICE_ADMIN" })
  const ui = await Page({ params: Promise.resolve({ id: "2" }) })
  expect(ui).toBeTruthy()
})

it("notFound when user missing", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  ;(prisma.user.findUnique as jest.Mock).mockResolvedValue(null)
  await expect(Page({ params: Promise.resolve({ id: "999" }) })).rejects.toThrow("NOTFOUND")
})

it("notFound for a non-numeric id", async () => {
  ;(auth as jest.Mock).mockResolvedValue({ user: { role: "ADMIN", id: "1" } })
  await expect(Page({ params: Promise.resolve({ id: "abc" }) })).rejects.toThrow("NOTFOUND")
  expect(prisma.user.findUnique).not.toHaveBeenCalled()
})
