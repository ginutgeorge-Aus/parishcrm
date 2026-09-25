/** @jest-environment node */
import { getXferAccountId } from "@/lib/xferAccount"

it("returns the existing XFER account id", async () => {
  const client = { account: { findUnique: jest.fn().mockResolvedValue({ id: 7 }), upsert: jest.fn() } } as any
  expect(await getXferAccountId(client)).toBe(7)
  expect(client.account.upsert).not.toHaveBeenCalled()
})

it("upserts the XFER account when missing", async () => {
  const client = { account: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 8 }) } } as any
  expect(await getXferAccountId(client)).toBe(8)
  expect(client.account.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { code: "XFER" },
      create: expect.objectContaining({ code: "XFER", type: "EXPENSE", isActive: false }),
    })
  )
})

// //: two concurrent requests both miss on findUnique and race.
// upsert (INSERT … ON CONFLICT) resolves the loser to the winner's row without a
// P2002 that would abort a surrounding transaction — no re-read needed.
it("resolves to the winner's row via upsert on a concurrent race", async () => {
  const findUnique = jest.fn().mockResolvedValue(null)
  const upsert = jest.fn().mockResolvedValue({ id: 9 })
  const client = { account: { findUnique, upsert } } as any
  expect(await getXferAccountId(client)).toBe(9)
  expect(findUnique).toHaveBeenCalledTimes(1)
})

it("rethrows an upsert failure", async () => {
  const client = {
    account: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockRejectedValue({ code: "P2003" }) },
  } as any
  await expect(getXferAccountId(client)).rejects.toEqual({ code: "P2003" })
})
