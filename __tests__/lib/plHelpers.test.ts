import { FY_MONTHS, MONTH_LABELS, monthlyAmounts, monthlySum, monthlyAmountsByAccount, accumulateMonthlyByAccount, accountBalance, type MonthlyTx } from "@/lib/reports/plHelpers"

function makeTx(amount: string, month: number, year = 2025): MonthlyTx {
  return { amount: { toString: () => amount }, date: new Date(year, month, 15) }
}

function makeTxFor(accountId: number, amount: string, month: number, year = 2025) {
  return { accountId, amount: { toString: () => amount }, date: new Date(year, month, 15) }
}

describe("FY_MONTHS", () => {
  it("has 12 entries starting with July (6) and ending with June (5)", () => {
    expect(FY_MONTHS).toHaveLength(12)
    expect(FY_MONTHS[0]).toBe(6)
    expect(FY_MONTHS[11]).toBe(5)
  })
})

describe("MONTH_LABELS", () => {
  it("has 12 labels starting with JUL and ending with JUN", () => {
    expect(MONTH_LABELS).toHaveLength(12)
    expect(MONTH_LABELS[0]).toBe("JUL")
    expect(MONTH_LABELS[11]).toBe("JUN")
  })
})

// monthly* helpers return integer CENTS — sums stay exact across many Decimals.
describe("monthlyAmounts", () => {
  it("returns 12 zeros for empty transaction list", () => {
    expect(monthlyAmounts([])).toEqual(new Array(12).fill(0))
  })

  it("places July transaction (month=6) at index 0", () => {
    const result = monthlyAmounts([makeTx("100", 6)])
    expect(result[0]).toBe(10000)
    expect(result.slice(1).every((v) => v === 0)).toBe(true)
  })

  it("places June transaction (month=5) at index 11", () => {
    const result = monthlyAmounts([makeTx("200", 5)])
    expect(result[11]).toBe(20000)
  })

  it("places August transaction (month=7) at index 1", () => {
    const result = monthlyAmounts([makeTx("50", 7)])
    expect(result[1]).toBe(5000)
  })

  it("places January transaction (month=0) at index 6", () => {
    const result = monthlyAmounts([makeTx("75", 0)])
    expect(result[6]).toBe(7500)
  })

  it("sums multiple transactions in the same month exactly (cents)", () => {
    const result = monthlyAmounts([makeTx("100", 6), makeTx("50.50", 6)])
    expect(result[0]).toBe(15050)
  })

  it("does not accumulate float drift across many transactions", () => {
    // 10 × $0.10 → exactly $1.00 (1.0 in float, but cents proves no drift path)
    const result = monthlyAmounts(new Array(10).fill(null).map(() => makeTx("0.10", 6)))
    expect(result[0]).toBe(100)
  })

  it("handles transactions across multiple FY months independently", () => {
    const result = monthlyAmounts([makeTx("100", 6), makeTx("200", 7), makeTx("300", 5)])
    expect(result[0]).toBe(10000)  // Jul
    expect(result[1]).toBe(20000)  // Aug
    expect(result[11]).toBe(30000) // Jun
  })

  // FY July-1 boundary. The app stores transaction dates as date-only
  // values via `new Date("YYYY-MM-DD")`, i.e. UTC midnight. monthlyAmounts buckets
  // by getUTCMonth() so the stored calendar month is read directly — independent of
  // the runner/server timezone. Using getMonth() (server local) bucketed a
  // UTC-midnight July 1 into June on a Sydney-tz server; these tests pin the
  // UTC reading and are deterministic on every CI runner.
  describe("July 1 boundary (UTC calendar month)", () => {
    it("buckets UTC-midnight July 1 into July (FY index 0), not June", () => {
      expect(monthlyAmounts([{ amount: { toString: () => "100" }, date: new Date("2025-07-01T00:00:00Z") }])[0]).toBe(10000)
    })

    it("buckets UTC-midnight June 30 into June (FY index 11)", () => {
      expect(monthlyAmounts([{ amount: { toString: () => "100" }, date: new Date("2025-06-30T00:00:00Z") }])[11]).toBe(10000)
    })

    it("buckets a noon-UTC July 1 into July regardless of runner tz", () => {
      expect(monthlyAmounts([{ amount: { toString: () => "100" }, date: new Date("2025-07-01T12:00:00Z") }])[0]).toBe(10000)
    })

    it("monthlyAmountsByAccount uses the same UTC month reading", () => {
      const map = monthlyAmountsByAccount([
        { accountId: 1, amount: { toString: () => "100" }, date: new Date("2025-07-01T00:00:00Z") },
      ])
      expect(map.get(1)![0]).toBe(10000)
    })
  })
})

describe("monthlySum", () => {
  it("returns 12 zeros for empty account list", () => {
    expect(monthlySum([])).toEqual(new Array(12).fill(0))
  })

  it("returns 12 zeros for accounts with no transactions", () => {
    expect(monthlySum([[], []])).toEqual(new Array(12).fill(0))
  })

  it("sums transactions across multiple accounts in the same month", () => {
    const result = monthlySum([[makeTx("100", 6)], [makeTx("50", 6)]])
    expect(result[0]).toBe(15000)
  })

  it("handles different months across accounts independently", () => {
    const result = monthlySum([[makeTx("100", 6)], [makeTx("200", 7)]])
    expect(result[0]).toBe(10000) // Jul: only first account
    expect(result[1]).toBe(20000) // Aug: only second account
  })
})

describe("monthlyAmountsByAccount", () => {
  it("returns an empty map for empty input", () => {
    expect(monthlyAmountsByAccount([]).size).toBe(0)
  })

  it("buckets transactions per account using FY month-index logic", () => {
    const map = monthlyAmountsByAccount([
      makeTxFor(1, "100", 6),  // acct 1, Jul -> index 0
      makeTxFor(1, "50", 7),   // acct 1, Aug -> index 1
      makeTxFor(2, "300", 5),  // acct 2, Jun -> index 11
    ])
    expect(map.get(1)![0]).toBe(10000)
    expect(map.get(1)![1]).toBe(5000)
    expect(map.get(2)![11]).toBe(30000)
    // unrelated months stay zero
    expect(map.get(1)![11]).toBe(0)
  })

  it("sums multiple transactions for the same account and month (cents)", () => {
    const map = monthlyAmountsByAccount([
      makeTxFor(1, "100", 6),
      makeTxFor(1, "50.50", 6),
    ])
    expect(map.get(1)![0]).toBe(15050)
  })

  it("produces the same per-account array as monthlyAmounts", () => {
    const txs = [makeTxFor(7, "100", 6), makeTxFor(7, "200", 7), makeTxFor(7, "300", 5)]
    const byAccount = monthlyAmountsByAccount(txs)
    const direct = monthlyAmounts(txs.map((t) => ({ amount: t.amount, date: t.date })))
    expect(byAccount.get(7)).toEqual(direct)
  })
})

// streaming the FY in batches must produce the exact same map as
// loading every row at once. These tests pin that equivalence.
describe("accumulateMonthlyByAccount (streaming fold)", () => {
  it("accumulates a single batch into an empty map like monthlyAmountsByAccount", () => {
    const txs = [makeTxFor(1, "100", 6), makeTxFor(1, "50", 7), makeTxFor(2, "300", 5)]
    const map = new Map<number, number[]>()
    accumulateMonthlyByAccount(map, txs)
    expect(map).toEqual(monthlyAmountsByAccount(txs))
  })

  it("folds multiple batches into one map identically to a single-shot call", () => {
    const batch1 = [makeTxFor(1, "100", 6), makeTxFor(2, "300", 5)]
    const batch2 = [makeTxFor(1, "50", 6), makeTxFor(1, "25", 7)] // same acct/month split across batches
    const streamed = new Map<number, number[]>()
    accumulateMonthlyByAccount(streamed, batch1)
    accumulateMonthlyByAccount(streamed, batch2)
    expect(streamed).toEqual(monthlyAmountsByAccount([...batch1, ...batch2]))
    // and the cross-batch same-month sum is exact (100 + 50 = 150.00 in Jul)
    expect(streamed.get(1)![0]).toBe(15000)
    expect(streamed.get(1)![1]).toBe(2500)
  })

  it("is a no-op for an empty batch", () => {
    const map = new Map<number, number[]>([[1, new Array<number>(12).fill(0)]])
    accumulateMonthlyByAccount(map, [])
    expect(map.get(1)).toEqual(new Array(12).fill(0))
  })
})

describe("accountBalance ( cent-safe)", () => {
  const d = (s: string) => ({ toString: () => s })

  it("computes opening + income - expense without float drift", () => {
    // Number(0.1) + Number(0.2) === 0.30000000000000004 under IEEE-754
    expect(accountBalance(d("0.1"), d("0.2"), null)).toBe(0.3)
  })

  it("handles realistic dollar/cent values", () => {
    expect(accountBalance(d("1000.10"), d("2000.20"), d("500.05"))).toBe(2500.25)
  })

  it("treats null aggregates as zero", () => {
    expect(accountBalance(d("150.00"), null, null)).toBe(150)
  })

  it("supports negative (overdrawn) results", () => {
    expect(accountBalance(d("0.00"), d("10.00"), d("25.50"))).toBe(-15.5)
  })
})
