import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MembershipForm } from "../MembershipForm"

const submit = jest.fn().mockResolvedValue({ success: "ok" })
jest.mock("@/lib/actions/membership", () => ({ submitMembershipApplication: (...a: unknown[]) => submit(...a) }))
jest.mock("@/components/public-membership/SignaturePad", () => ({
  SignaturePad: ({ onChange }: { onChange: (d: string) => void }) => (
    <button type="button" onClick={() => onChange("data:image/png;base64,AAAA")}>sign</button>
  ),
}))
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
  expect(screen.getByText("A. Personal particulars")).toBeInTheDocument()
  expect(screen.getByText("F. Subscription & declaration")).toBeInTheDocument()
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
  // Sex/Marital status are shadcn Select (Radix) — the labelled control is the
  // trigger button, not a native <select> ( swapped raw controls for shadcn).
  expect(screen.getByLabelText("Sex")).toHaveProperty("tagName", "BUTTON")
  expect(screen.getByLabelText("Marital status")).toHaveProperty("tagName", "BUTTON")
})

it("renders section dividers as navigable headings", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  expect(screen.getByRole("heading", { name: "A. Personal particulars" })).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "C. Name of children" })).toBeInTheDocument()
})

it("gives repeating-row cells distinct accessible names", () => {
  render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
  // Children section, first row — column identity + row number, not a bare placeholder
  expect(screen.getByLabelText("C. Name of children, row 1 Occupation")).toBeInTheDocument()
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
    expect(screen.getByLabelText("Residential address *")).toHaveAttribute("autoComplete", "street-address")
    expect(screen.getByLabelText("Suburb *")).toHaveAttribute("autoComplete", "address-level2")
    expect(screen.getByLabelText("State *")).toHaveAttribute("autoComplete", "address-level1")
    const postcodeInput = screen.getByLabelText("Postcode *")
    expect(postcodeInput).toHaveAttribute("autoComplete", "postal-code")
    expect(postcodeInput).toHaveAttribute("inputMode", "numeric")
  })

  it("opts spouse fields out of autofill so the registrant's own details aren't offered", () => {
    render(<MembershipForm churchName="Demo Church" churchWebsite="https://demo.example.com" parishFields={false} minDues={null} homeAddressLabel="" arrivalDateLabel="" />)
    expect(screen.getByLabelText("Name of spouse")).toHaveAttribute("autoComplete", "off")
    expect(screen.getByLabelText("Spouse e-mail ID")).toHaveAttribute("autoComplete", "off")
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

describe("field-level server errors", () => {
  const props = { churchName: "Demo Church", churchWebsite: "https://demo.example.com", parishFields: false, minDues: null, homeAddressLabel: "", arrivalDateLabel: "" }
  function fillRequired() {
    const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
    set("Name *", "Jo Demo")
    set("E-mail ID *", "jo@example.com")
    set("Residential address *", "1 Example St")
    set("Suburb *", "Sampletown")
    set("State *", "NSW")
    set("Postcode *", "2000")
  }

  it("catches an email the browser accepts but the schema refuses, before submit", async () => {
    render(<MembershipForm {...props} />)
    fillRequired()
    fireEvent.change(screen.getByLabelText("E-mail ID *"), { target: { value: "mary@bad" } })
    fireEvent.submit(screen.getByRole("button", { name: /submit membership form/i }).closest("form")!)
    const input = screen.getByLabelText("E-mail ID *")
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"))
    expect(screen.getAllByText(/valid email address/i).length).toBeGreaterThan(0)
    expect(submit).not.toHaveBeenCalled()
  })

  async function submitWith(res: unknown) {
    submit.mockResolvedValueOnce(res)
    fireEvent.change(screen.getByLabelText(/My monthly subscription/), { target: { value: "20" } })
    fireEvent.click(screen.getByRole("button", { name: "sign" }))
    fireEvent.submit(screen.getByRole("button", { name: /submit membership form/i }).closest("form")!)
  }

  it("marks the personal input named by the server's field path", async () => {
    render(<MembershipForm {...props} />)
    fillRequired()
    await submitWith({ error: "Date of birth: enter a real date", field: "personal.dateOfBirth" })
    const dob = screen.getByLabelText("Date of birth", { selector: "#dob" })
    await waitFor(() => expect(dob).toHaveAttribute("aria-invalid", "true"))
    expect(dob).toHaveAttribute("aria-describedby", "dob-error")
    expect(screen.getByText("enter a real date")).toBeInTheDocument()
  })

  it("maps a filtered children row index back to the on-screen row", async () => {
    render(<MembershipForm {...props} />)
    fillRequired()
    // Row 1 is blank and filtered out of the payload, so payload row 0 = on-screen row 2.
    fireEvent.click(screen.getAllByRole("button", { name: /add row/i })[0])
    fireEvent.change(document.getElementById("c-name-of-children-name-1")!, { target: { value: "Kid Demo" } })
    await submitWith({ error: "Child: bad occupation", field: "children.0.occupation" })
    await waitFor(() => expect(document.getElementById("c-name-of-children-occupation-1")).toHaveAttribute("aria-invalid", "true"))
    expect(document.getElementById("c-name-of-children-occupation-0")).not.toHaveAttribute("aria-invalid")
  })

  it("maps spouse, subscription and declaration paths to their inputs", async () => {
    render(<MembershipForm {...props} />)
    fillRequired()
    await submitWith({ error: "Spouse email: invalid", field: "spouse.email" })
    await waitFor(() => expect(document.getElementById("spouseEmail")).toHaveAttribute("aria-invalid", "true"))
  })

  it("falls back to the banner when the field path is unknown", async () => {
    render(<MembershipForm {...props} />)
    fillRequired()
    await submitWith({ error: "Something odd", field: "bogus.path" })
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Something odd"))
    expect(document.querySelector("[aria-invalid=true]")).toBeNull()
  })

  it("catches a bad spouse email client-side when a spouse is named", async () => {
    render(<MembershipForm {...props} />)
    fillRequired()
    fireEvent.change(document.getElementById("spouseName")!, { target: { value: "Pat Demo" } })
    fireEvent.change(document.getElementById("spouseEmail")!, { target: { value: "pat@bad" } })
    fireEvent.submit(screen.getByRole("button", { name: /submit membership form/i }).closest("form")!)
    await waitFor(() => expect(document.getElementById("spouseEmail")).toHaveAttribute("aria-invalid", "true"))
    expect(submit).not.toHaveBeenCalled()
  })
})
