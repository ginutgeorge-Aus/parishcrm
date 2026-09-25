jest.mock("@/lib/churchSettings", () => ({
  getChurchSettings: jest.fn().mockResolvedValue({
    name: "Demo Church", address: "", abn: "", email: "", website: "",
  }),
}))
// layout.tsx's top-level imports pull in Providers.tsx -> next-auth/react (an
// ESM-only package). generateMetadata/RootLayout never touch it directly, but
// merely importing the module evaluates that import statement. Stub it out
// the same way __tests__/components/LoginForm.test.tsx already does, so this
// metadata-only test doesn't require Node >=24.9's require(ESM) support.
jest.mock("next-auth/react", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}))
import { generateMetadata } from "@/app/layout"
import manifest from "@/app/manifest"

test("root metadata title/description come from church settings", async () => {
  const m = await generateMetadata()
  expect(m.title).toContain("Demo Church")
  expect(JSON.stringify(m)).not.toMatch(/Example Church/i)
})

test("manifest name comes from church settings", async () => {
  const mf = await manifest()
  expect(mf.name).toContain("Demo Church")
  expect(mf.short_name).toContain("Demo Church")
})
