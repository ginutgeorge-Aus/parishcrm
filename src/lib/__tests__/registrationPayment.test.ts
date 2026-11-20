import { owesPayment, paymentStatusColour, paymentStatusLabel } from "@/lib/registrationPayment"

describe("owesPayment", () => {
  test.each([
    ["PENDING", "10.00", true],
    ["PENDING", 10, true],
    ["PENDING", "0.00", false],
    ["PENDING", 0, false],
    ["PAID", "10.00", false],
    ["CANCELLED", "10.00", false],
    ["PENDING", "abc", true],
  ])("%s / %s -> %s", (paymentStatus, totalAmount, expected) => {
    expect(owesPayment({ paymentStatus, totalAmount })).toBe(expected)
  })
})

describe("paymentStatusLabel", () => {
  test("free pending reads No payment needed", () => {
    expect(paymentStatusLabel({ paymentStatus: "PENDING", totalAmount: "0.00" })).toBe("No payment needed")
  })
  test("owing pending reads Pending", () => {
    expect(paymentStatusLabel({ paymentStatus: "PENDING", totalAmount: "5.00" })).toBe("Pending")
  })
  test("paid reads Paid", () => {
    expect(paymentStatusLabel({ paymentStatus: "PAID", totalAmount: "0.00" })).toBe("Paid")
  })
})

describe("paymentStatusColour", () => {
  test("free pending is neutral, owing pending is amber", () => {
    expect(paymentStatusColour({ paymentStatus: "PENDING", totalAmount: 0 })).toContain("bg-muted")
    expect(paymentStatusColour({ paymentStatus: "PENDING", totalAmount: 5 })).toContain("bg-gold")
    expect(paymentStatusColour({ paymentStatus: "PAID", totalAmount: 0 })).toContain("bg-income")
  })
})
