import { render, screen } from "@testing-library/react"
import { LetterSettingsForm } from "@/components/settings/LetterSettingsForm"
import type { BankAccount, LetterSettings } from "@/lib/letterSettings"

jest.mock("@/lib/actions/settings", () => ({ updateLetterSettings: jest.fn() }))
// letterSettings.ts pulls in the prisma adapter chain, which jsdom can't load
jest.mock("@/lib/prisma", () => ({ prisma: {} }))

const account = (fundLabel: string, taxDeductible: boolean): BankAccount => ({
  fundLabel, bank: "", bsb: "", account: "", accountName: "", taxDeductible,
})

const settings: LetterSettings = {
  general: account("Parish Offertory", false),
  building: account("Church Extension Fund", true),
  signerName: "", signerTitle: "",
  introTemplate: "", contributionsTemplate: "", closingTemplate: "",
}

describe("LetterSettingsForm", () => {
  it("heads each bank subgroup with the church's configured fund label", () => {
    render(<LetterSettingsForm settings={settings} />)
    expect(screen.getByText("Parish Offertory")).toBeInTheDocument()
    expect(screen.getByText("Church Extension Fund")).toBeInTheDocument()
    expect(screen.queryByText("Building fund account")).not.toBeInTheDocument()
  })
})
