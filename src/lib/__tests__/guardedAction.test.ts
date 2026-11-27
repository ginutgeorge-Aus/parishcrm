/** @jest-environment node */
import { z } from "zod"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/featureFlags", () => ({ featureGuard: jest.fn(), assertFeature: jest.fn() }))
jest.mock("@/lib/demoMode", () => ({ assertNotDemo: jest.fn() }))

import { auth } from "@/auth"
import { assertFeature, featureGuard } from "@/lib/featureFlags"
import { assertNotDemo } from "@/lib/demoMode"
import { isAdmin, canViewAccounting } from "@/lib/roleGuard"
import { guardedAction, pgIdArg, formDataArg, prevStateArg } from "../guardedAction"

const mockAuth = auth as jest.Mock
const mockFeatureGuard = featureGuard as jest.Mock
const mockAssertFeature = assertFeature as jest.Mock
const mockDemo = assertNotDemo as jest.Mock

const admin = { user: { id: "1", role: "ADMIN" } }

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue(admin)
  mockFeatureGuard.mockResolvedValue(null)
  mockAssertFeature.mockResolvedValue(undefined)
  mockDemo.mockReturnValue(null)
})

/**
 * A wrapped "delete by id" action, ADMIN only, accounting feature.
 * @param raw the id exactly as a client sent it
 * @param handler spy for the action body
 */
function del(raw: unknown, handler: jest.Mock = jest.fn(async () => undefined)) {
  return guardedAction({ guard: isAdmin, feature: "accounting", args: z.tuple([pgIdArg]) }, [raw], handler)
}

describe("guardedAction", () => {
  it("runs the handler with the session and parsed arguments", async () => {
    const handler = jest.fn(async () => ({ success: "ok" }))
    await expect(del(7, handler)).resolves.toEqual({ success: "ok" })
    expect(handler).toHaveBeenCalledWith({ session: admin }, [7])
  })

  it("refuses a signed-out caller before the feature check, argument parse or handler", async () => {
    mockAuth.mockResolvedValue(null)
    const handler = jest.fn()
    await expect(del(7, handler)).resolves.toEqual({ error: "Unauthorized" })
    expect(mockFeatureGuard).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it("refuses a role the guard rejects", async () => {
    mockAuth.mockResolvedValue({ user: { id: "2", role: "OFFICE_ADMIN" } })
    const handler = jest.fn()
    await expect(del(7, handler)).resolves.toEqual({ error: "Unauthorized" })
    expect(handler).not.toHaveBeenCalled()
  })

  it("returns the feature-off result after the role check passes", async () => {
    mockFeatureGuard.mockResolvedValue({ error: "This feature is turned off" })
    const handler = jest.fn()
    await expect(del(7, handler)).resolves.toEqual({ error: "This feature is turned off" })
    expect(mockFeatureGuard).toHaveBeenCalledWith("accounting")
    expect(handler).not.toHaveBeenCalled()
  })

  it.each([
    ["an object (Prisma filter)", { not: 0 }],
    ["a numeric string", "7"],
    ["zero", 0],
    ["a float", 1.5],
    ["past the int4 bound", 2147483648],
    ["undefined", undefined],
  ])("rejects %s as an id without running the handler", async (_label, raw) => {
    const handler = jest.fn()
    await expect(del(raw, handler)).resolves.toEqual({ error: "Invalid ID" })
    expect(handler).not.toHaveBeenCalled()
  })

  it("rejects extra arguments beyond the tuple", async () => {
    const handler = jest.fn()
    const r = await guardedAction({ guard: isAdmin, args: z.tuple([pgIdArg]) }, [7, { extra: 1 }], handler)
    expect(r).toEqual({ error: expect.any(String) })
    expect(handler).not.toHaveBeenCalled()
  })

  it("form actions: accepts any previous state and requires FormData", async () => {
    const spec = { guard: isAdmin, args: z.tuple([prevStateArg, formDataArg]) }
    const handler = jest.fn(async () => undefined)
    await guardedAction(spec, [{ error: "old" }, new FormData()], handler)
    expect(handler).toHaveBeenCalledTimes(1)
    await expect(guardedAction(spec, [undefined, { name: "x" }], handler)).resolves.toEqual({ error: "Invalid form data" })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("blockInDemo refuses before auth", async () => {
    mockDemo.mockReturnValue({ error: "Disabled in the live demo" })
    const handler = jest.fn()
    const r = await guardedAction({ guard: isAdmin, args: z.tuple([]), blockInDemo: true }, [], handler)
    expect(r).toEqual({ error: "Disabled in the live demo" })
    expect(mockAuth).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it("does not consult demo mode unless asked", async () => {
    mockDemo.mockReturnValue({ error: "Disabled in the live demo" })
    await expect(del(7)).resolves.toBeUndefined()
  })

  it("public actions skip auth and give the handler a null session", async () => {
    const handler = jest.fn(async () => "done")
    const r = await guardedAction({ guard: "public", args: z.tuple([z.string().max(10)]) }, ["abc"], handler)
    expect(r).toBe("done")
    expect(mockAuth).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledWith({ session: null }, ["abc"])
  })

  it("public actions still validate arguments", async () => {
    const handler = jest.fn()
    const r = await guardedAction({ guard: "public", args: z.tuple([z.string().max(10)]) }, [{ not: "" }], handler)
    expect(r).toEqual({ error: expect.any(String) })
    expect(handler).not.toHaveBeenCalled()
  })

  describe("readers (denied value)", () => {
    /**
     * A wrapped reader that lists rows for accounting viewers.
     * @param raw the raw argument
     * @param handler spy for the action body
     */
    const list = (raw: unknown, handler = jest.fn(async () => [{ id: 1 }])) =>
      guardedAction({ guard: canViewAccounting, feature: "accounting", args: z.tuple([pgIdArg]), denied: [] as { id: number }[] }, [raw], handler)

    it("returns the denied value for a refused role and for bad arguments", async () => {
      mockAuth.mockResolvedValue({ user: { id: "3", role: "VIEWER" } })
      await expect(list(1)).resolves.toEqual([])
      mockAuth.mockResolvedValue(admin)
      await expect(list("1")).resolves.toEqual([])
    })

    it("uses the throwing feature check (no { error } shape to return)", async () => {
      mockAssertFeature.mockRejectedValue(new Error("off"))
      await expect(list(1)).rejects.toThrow("off")
      expect(mockFeatureGuard).not.toHaveBeenCalled()
    })

    it("returns the handler result when allowed", async () => {
      await expect(list(1)).resolves.toEqual([{ id: 1 }])
    })

    it("returns the denied value for the demo block", async () => {
      mockDemo.mockReturnValue({ error: "Disabled in the live demo" })
      const r = await guardedAction({ guard: isAdmin, args: z.tuple([]), denied: false, blockInDemo: true }, [], async () => true)
      expect(r).toBe(false)
    })
  })
})
