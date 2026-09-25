import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { TrustedDeviceList } from "@/components/account/TrustedDeviceList"

jest.mock("@/lib/actions/trustedDevice", () => ({ revokeTrustedDevice: jest.fn().mockResolvedValue({ success: true }) }))
import { revokeTrustedDevice } from "@/lib/actions/trustedDevice"

const devices = [
  { id: "d1", label: "TestUA/1.0", createdAt: new Date("2026-06-01"), lastUsedAt: new Date("2026-06-20") },
]

it("lists devices and revokes one", async () => {
  render(<TrustedDeviceList devices={devices} />)
  expect(screen.getByText(/TestUA\/1\.0/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: /revoke/i }))
  await waitFor(() => expect(revokeTrustedDevice).toHaveBeenCalledWith("d1"))
})

it("shows an empty state when there are no devices", () => {
  render(<TrustedDeviceList devices={[]} />)
  expect(screen.getByText(/no trusted devices/i)).toBeInTheDocument()
})
