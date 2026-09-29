import { render, screen } from "@testing-library/react"
import { LoginForm } from "@/components/auth/LoginForm"

jest.mock("next-auth/react", () => ({ signIn: jest.fn() }))
jest.mock("@/lib/actions/trustedDevice", () => ({ trustDevice: jest.fn() }))

let params: Record<string, string> = {}
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => ({ get: (k: string) => params[k] ?? null }),
}))

describe("LoginForm — post-setup banner", () => {
  it("confirms the admin was created when arriving from /setup", () => {
    params = { setup: "1" }
    render(<LoginForm churchName="Demo Church" />)
    expect(screen.getByText("Administrator created. Sign in to continue.")).toBeInTheDocument()
  })

  it("is hidden on a normal visit", () => {
    params = {}
    render(<LoginForm churchName="Demo Church" />)
    expect(screen.queryByText("Administrator created. Sign in to continue.")).not.toBeInTheDocument()
  })
})
