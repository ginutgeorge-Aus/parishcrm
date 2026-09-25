import { calcRunningBalance } from "@/lib/pettyCashLedger"

describe("calcRunningBalance", () => {
  it("returns opening balance with no activity", () => {
    expect(calcRunningBalance(100, [], [], [])).toBe(100)
  })

  it("adds receipts to opening balance", () => {
    expect(calcRunningBalance(0, [{ amount: 100 }, { amount: 50 }], [], [])).toBe(150)
  })

  it("subtracts expenses from balance", () => {
    expect(calcRunningBalance(200, [], [{ amount: 30 }, { amount: 20 }], [])).toBe(150)
  })

  it("subtracts transfers from balance", () => {
    expect(calcRunningBalance(0, [{ amount: 500 }], [], [{ amount: 400 }])).toBe(100)
  })

  it("handles combined receipts, expenses, and transfers", () => {
    expect(calcRunningBalance(0, [{ amount: 500 }], [{ amount: 50 }], [{ amount: 400 }])).toBe(50)
  })

  it("returns zero when all cash transferred", () => {
    expect(calcRunningBalance(100, [], [], [{ amount: 100 }])).toBe(0)
  })

  it("uses opening balance for handover sessions", () => {
    expect(calcRunningBalance(450, [{ amount: 200 }], [{ amount: 30 }], [])).toBe(620)
  })

  it("accepts Decimal-like amounts and stays cent-exact", () => {
    const d = (s: string) => ({ toString: () => s })
    // 3 × $0.10 receipts − $0.20 expense → $0.10, with no float drift
    expect(
      calcRunningBalance(d("0.00"), [{ amount: d("0.10") }, { amount: d("0.10") }, { amount: d("0.10") }], [{ amount: d("0.20") }], []),
    ).toBe(0.1)
  })
})
