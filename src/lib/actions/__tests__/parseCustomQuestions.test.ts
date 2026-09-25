/** @jest-environment node */
import { parseCustomQuestions } from "@/lib/eventQuestions"

jest.mock("@/auth", () => ({ auth: jest.fn(async () => ({ user: { id: "1", role: "ADMIN" } })) }))
jest.mock("@/lib/websiteSync", () => ({
  syncEventToWebsite: jest.fn(async () => {}),
  syncEventDeletion: jest.fn(async () => {}),
  resyncAllEvents: jest.fn(async () => {}),
}))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }))
jest.mock("next/navigation", () => ({
  redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))
jest.mock("@/lib/prisma", () => ({
  prisma: {
    event: { create: jest.fn(), update: jest.fn() },
  },
}))

function fd(fields: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

describe("parseCustomQuestions — allowOther", () => {
  it("sets allowOther on a select when the flag is 'true'", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Pickup",
      "customQuestion.0.type": "select",
      "customQuestion.0.options": "Parent",
      "customQuestion.0.allowOther": "true",
    }))
    expect(qs).toEqual([expect.objectContaining({ type: "select", allowOther: true })])
  })

  it("omits allowOther when the flag is absent", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Pickup",
      "customQuestion.0.type": "select",
      "customQuestion.0.options": "Parent",
    }))
    expect(qs?.[0]).not.toHaveProperty("allowOther")
  })

  it("ignores allowOther on a non-choice type", () => {
    const qs = parseCustomQuestions(fd({
      "customQuestion.0.label": "Name",
      "customQuestion.0.type": "text",
      "customQuestion.0.allowOther": "true",
    }))
    expect(qs?.[0]).not.toHaveProperty("allowOther")
  })
})
