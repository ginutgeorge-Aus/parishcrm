import { updateSessionCustodian } from "@/lib/actions/pettyCashSession"
import { prisma } from "@/lib/prisma"
import { auth } from "@/auth"

jest.mock("@/auth", () => ({ auth: jest.fn() }))
jest.mock("@/lib/generated/prisma/client", () => ({
  Prisma: { TransactionIsolationLevel: { Serializable: "Serializable" } },
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("@/lib/crypto", () => ({
  encrypt: jest.fn((v: string) => `enc:${v}`),
  decrypt: jest.fn((v: string) => v.replace(/^enc:/, "")),
}))
jest.mock("@/lib/actor", () => ({ actorId: jest.fn(() => 1) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), unstable_cache: (fn: (...a: unknown[]) => unknown) => fn }))
jest.mock("next/navigation", () => ({ redirect: jest.fn() }))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    pettyCashSession: { findUnique: jest.fn(), update: jest.fn() },
    person: { findFirst: jest.fn() },
  },
}))

const mockAuth = auth as jest.Mock
const mockSessionFind = prisma.pettyCashSession.findUnique as jest.Mock
const mockSessionUpdate = prisma.pettyCashSession.update as jest.Mock
const mockPersonFind = prisma.person.findFirst as jest.Mock

function fd(fields: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAuth.mockResolvedValue({ user: { id: "1", role: "ADMIN" } })
  mockSessionFind.mockResolvedValue({ id: 1 })
  mockPersonFind.mockResolvedValue({ id: 5 })
  mockSessionUpdate.mockResolvedValue({})
})

test("unauthorized role rejected, no write", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "VIEWER" } })
  const res = await updateSessionCustodian(1, undefined, fd({ custodianId: "5" }))
  expect(res).toEqual({ error: "Unauthorized" })
  expect(mockSessionUpdate).not.toHaveBeenCalled()
})

test("AUDITOR (read-only accounting) rejected", async () => {
  mockAuth.mockResolvedValue({ user: { id: "1", role: "AUDITOR" } })
  const res = await updateSessionCustodian(1, undefined, fd({ custodianId: "5" }))
  expect(res).toEqual({ error: "Unauthorized" })
  expect(mockSessionUpdate).not.toHaveBeenCalled()
})

test("blank custodian rejected", async () => {
  const res = await updateSessionCustodian(1, undefined, fd({ custodianId: "" }))
  expect(res && "error" in res && res.error).toMatch(/required/i)
  expect(mockSessionUpdate).not.toHaveBeenCalled()
})

test("missing session rejected (IDOR guard)", async () => {
  mockSessionFind.mockResolvedValue(null)
  const res = await updateSessionCustodian(9, undefined, fd({ custodianId: "5" }))
  expect(res).toEqual({ error: "Session not found" })
  expect(mockSessionUpdate).not.toHaveBeenCalled()
})

test("nonexistent custodian rejected", async () => {
  mockPersonFind.mockResolvedValue(null)
  const res = await updateSessionCustodian(1, undefined, fd({ custodianId: "999" }))
  expect(res).toEqual({ error: "Custodian not found" })
  expect(mockSessionUpdate).not.toHaveBeenCalled()
})

test("valid update persists new custodian + returns success", async () => {
  const res = await updateSessionCustodian(1, undefined, fd({ custodianId: "5" }))
  expect(mockSessionUpdate).toHaveBeenCalledWith({
    where: { id: 1 },
    data: { custodianId: 5 },
  })
  expect(res).toEqual({ success: "Custodian updated" })
})
