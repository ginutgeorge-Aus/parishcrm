import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MembershipForm } from "../MembershipForm"

const submit = jest.fn().mockResolvedValue({ success: "ok" })
jest.mock("@/lib/actions/membership", () => ({ submitMembershipApplication: (...a: unknown[]) => submit(...a) }))
const push = jest.fn()
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))

beforeEach(() => jest.clearAllMocks())

it("greets with the configured church name, not a hardcoded one", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  expect(screen.getByText(/Welcome to Demo Church!/)).toBeInTheDocument()
  expect(screen.queryByText(/St\.? Mark/i)).not.toBeInTheDocument()
})

it("renders the form sections", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  expect(screen.getByText("A. Personal Particulars")).toBeInTheDocument()
  expect(screen.getByText("F. Subscription & Declaration")).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /submit membership form/i })).toBeInTheDocument()
})

it("blocks submit and shows an error when required fields are blank", async () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  fireEvent.submit(screen.getByRole("button", { name: /submit membership form/i }).closest("form")!)
  await waitFor(() => expect(screen.getByText(/complete your name, email/i)).toBeInTheDocument())
  expect(submit).not.toHaveBeenCalled()
})

it("associates every visible label with its control", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  expect(screen.getByLabelText("Name *")).toHaveProperty("tagName", "INPUT")
  expect(screen.getByLabelText("E-mail ID *")).toHaveProperty("tagName", "INPUT")
  // Sex/Marital Status are shadcn Select (Radix) — the labelled control is the
  // trigger button, not a native <select> ( swapped raw controls for shadcn).
  expect(screen.getByLabelText("Sex")).toHaveProperty("tagName", "BUTTON")
  expect(screen.getByLabelText("Marital Status")).toHaveProperty("tagName", "BUTTON")
})

it("renders section dividers as navigable headings", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  expect(screen.getByRole("heading", { name: "A. Personal Particulars" })).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "C. Name of Children" })).toBeInTheDocument()
})

it("gives repeating-row cells distinct accessible names", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  // Children section, first row — column identity + row number, not a bare placeholder
  expect(screen.getByLabelText("C. Name of Children, row 1 Occupation")).toBeInTheDocument()
})

it("keeps each repeating-row column identifiable by a visible label, not just a placeholder", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  // The visible label persists after the placeholder would have vanished
  // (i.e. it's a real <label htmlFor>, not just the input's placeholder text).
  const occupationLabel = screen.getByText("Occupation", { selector: "label" })
  const inputId = occupationLabel.getAttribute("for")
  expect(inputId).toBeTruthy()
  expect(document.getElementById(inputId!)?.tagName).toBe("INPUT")
})

it("announces the submit error via role=alert", async () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  fireEvent.submit(screen.getByRole("button", { name: /submit membership form/i }).closest("form")!)
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/complete your name, email/i))
})

describe("mobile & conversion polish", () => {
  it("gives the registrant's own fields autofill + keyboard hints", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
    const emailInput = screen.getByLabelText("E-mail ID *")
    expect(emailInput).toHaveAttribute("autoComplete", "email")
    expect(emailInput).toHaveAttribute("inputMode", "email")
    const mobileInput = screen.getByLabelText("Mobile No.")
    expect(mobileInput).toHaveAttribute("type", "tel")
    expect(mobileInput).toHaveAttribute("autoComplete", "tel")
    expect(mobileInput).toHaveAttribute("inputMode", "tel")
    expect(screen.getByLabelText("Residential Address *")).toHaveAttribute("autoComplete", "street-address")
    expect(screen.getByLabelText("Suburb *")).toHaveAttribute("autoComplete", "address-level2")
    expect(screen.getByLabelText("State *")).toHaveAttribute("autoComplete", "address-level1")
    const postcodeInput = screen.getByLabelText("Postcode *")
    expect(postcodeInput).toHaveAttribute("autoComplete", "postal-code")
    expect(postcodeInput).toHaveAttribute("inputMode", "numeric")
  })

  it("opts spouse fields out of autofill so the registrant's own details aren't offered", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
    expect(screen.getByLabelText("Name of Spouse")).toHaveAttribute("autoComplete", "off")
    expect(screen.getByLabelText("Spouse E-mail ID")).toHaveAttribute("autoComplete", "off")
  })
})

describe("configurable membership fields (OSS)", () => {
  it("hides parish fields and the minimum when not configured", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
    expect(screen.queryByLabelText("Previous church")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Transfer letter from previous church provided?")).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Spouse's church")).not.toBeInTheDocument()
    expect(screen.queryByText(/minimum \$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/parish/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/India|arrival/i)).not.toBeInTheDocument()
  })

  it("shows overseas fields under the configured labels", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="" parishFields={false} minDues={null} homeAddressLabel="Address in India" arrivalDateLabel="Date of arrival in Australia" />)
    expect(screen.getByLabelText("Address in India")).toBeInTheDocument()
    expect(screen.getByLabelText("Date of arrival in Australia")).toHaveAttribute("type", "date")
  })

  it("shows generic parish labels and the configured minimum", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="" parishFields minDues={80} homeAddressLabel="" arrivalDateLabel="" />)
    expect(screen.getByLabelText("Previous church")).toBeInTheDocument()
    expect(screen.getByLabelText("Transfer letter from previous church provided?")).toBeInTheDocument()
    expect(screen.getByLabelText("Spouse's church")).toBeInTheDocument()
    expect(screen.getByLabelText(/minimum \$80/)).toHaveAttribute("min", "80")
    // Cent-level step so a decimal minimum (e.g. 80.50) doesn't make whole-dollar amounts a step mismatch.
    expect(screen.getByLabelText(/minimum \$80/)).toHaveAttribute("step", "0.01")
  })
})
