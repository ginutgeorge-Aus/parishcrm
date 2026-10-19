/** @jest-environment node */
// Behaviour sweep: every feature-gated segment layout and every gated Server
// Action really stops while its feature is off (featureGuards.test.ts only
// checks the source text). Files are discovered, so a new gated file is swept
// without an entry here.
import fs from "node:fs"
import path from "node:path"

jest.mock("server-only", () => ({}))
jest.mock("@/lib/featureFlags")
jest.mock("@/auth", () => ({ auth: jest.fn(), signIn: jest.fn(), signOut: jest.fn() }))
jest.mock("@/lib/prisma", () => ({ prisma: {} }))
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(), revalidateTag: jest.fn(), updateTag: jest.fn(),
  unstable_cache: (fn: unknown) => fn,
}))
jest.mock("next/headers", () => ({ headers: jest.fn(async () => new Map()), cookies: jest.fn() }))
jest.mock("@/lib/stripe", () => ({ stripeConfigured: () => true }))
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => { throw new Error("NEXT_NOT_FOUND") }),
  redirect: jest.fn(() => { throw new Error("NEXT_REDIRECT") }),
}))

import { assertFeature, featureGuard, featureGuardAny, isFeatureOn, requireFeature } from "@/lib/featureFlags"
import { auth } from "@/auth"
import { notFound } from "next/navigation"
import { PUBLIC_FEATURE_OFF_MESSAGE } from "@/lib/features"

const OFF = { error: "This feature is turned off." }
const root = process.cwd()

/** Recursively list files under `dir` (repo-relative) whose name matches `name`. */
function find(dir: string, name: RegExp): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? find(`${dir}/${e.name}`, name) : name.test(e.name) ? [`${dir}/${e.name}`] : [])
}

const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8")
const toModule = (f: string) => `@/${f.replace(/^src\//, "").replace(/\.tsx?$/, "")}`

const LAYOUTS = find("src/app", /^layout\.tsx$/).filter((f) => /await requireFeature\("/.test(read(f)))
const ACTION_FILES = fs.readdirSync(path.join(root, "src/lib/actions"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => `src/lib/actions/${f}`)
  .filter((f) => /^"use server"/m.test(read(f)) && /featureGuard(Any)?\(|assertFeature\(/.test(read(f)))

// Actions gated per input (the feature depends on an argument): call with a
// feature-owned value.
const templateForm = new FormData()
templateForm.set("key", "receipt")
const ARGS: Record<string, unknown[]> = {
  "emailTemplates.ts:updateEmailTemplate": [undefined, templateForm],
  "emailTemplates.ts:resetEmailTemplate": ["receipt"],
  "emailTemplates.ts:previewEmailTemplate": ["receipt", {}],
  "emailTemplates.ts:sendTestEmail": ["receipt", {}],
  // Public forms: honeypot/rate limit run first, so pass a clean input.
  "membership.ts:submitMembershipApplication": [{ payload: {}, signature: "" }],
  "familyUpdate.ts:submitFamilyUpdate": [{ token: "t", payload: {} }],
  "eventCheckout.ts:startEventCheckout": ["fete", {}],
  "eventCheckout.ts:startExistingRegistrationCheckout": ["fete", "tok"],
}
// Public actions answer anonymous callers without the admin wording.
const PUBLIC_OFF = new Set(["membership.ts:submitMembershipApplication", "familyUpdate.ts:submitFamilyUpdate"])
// Public actions (no sign-in): throttle → feature, so the anonymous test skips them.
const PUBLIC = new Set([...PUBLIC_OFF, "eventCheckout.ts:startEventCheckout", "eventCheckout.ts:startExistingRegistrationCheckout"])
// Feature checks run after auth, so the off test signs in as an ADMIN.
const ADMIN = { user: { id: "1", role: "ADMIN", email: "admin@example.com" } }

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.DEMO_MODE
})

it("discovers the gated files", () => {
  expect(LAYOUTS.length).toBeGreaterThan(20)
  expect(ACTION_FILES.length).toBeGreaterThan(30)
})

describe.each(LAYOUTS)("%s", (file) => {
  const key = /await requireFeature\("(\w+)"\)/.exec(read(file))![1]

  it(`404s while ${key} is off`, async () => {
    ;(requireFeature as jest.Mock).mockImplementationOnce(async () => notFound())
    const { default: Layout } = await import(toModule(file))
    await expect(Layout({ children: "page", params: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(requireFeature).toHaveBeenCalledWith(key)
  })

  it(`renders its children while ${key} is on`, async () => {
    const { default: Layout } = await import(toModule(file))
    await expect(Layout({ children: "page", params: Promise.resolve({}) })).resolves.toBe("page")
  })
})

describe.each(ACTION_FILES)("%s", (file) => {
  const src = read(file)
  const fns = [...src.matchAll(/^export async function (\w+)/gm)]
    .map((m, i, all) => ({ name: m[1], body: src.slice(m.index, all[i + 1]?.index ?? src.length) }))
    // upsertSetting gates per key (needs a real FormData): settings.test.ts covers it.
    .filter(({ name }) => name !== "upsertSetting")
    .filter(({ body }) => /featureGuard(Any)?\(|assertFeature\(|(?:await|return) (editor|editableClass|rollGuard|markerGuard|templateFeatureGuard|sendInvoiceGuarded)\(/.test(body))

  it.each(fns.map((f) => [f.name, f.body]))("%s stops while its feature is off", async (name, body) => {
    const mod = await import(toModule(file))
    ;(auth as jest.Mock).mockResolvedValue(ADMIN)
    ;(featureGuard as jest.Mock).mockResolvedValue(OFF)
    ;(featureGuardAny as jest.Mock).mockResolvedValue(OFF)
    ;(assertFeature as jest.Mock).mockRejectedValue(new Error(OFF.error))
    try {
      const call = mod[name](...(ARGS[`${path.basename(file)}:${name}`] ?? [])) as Promise<unknown>
      if (/assertFeature\(/.test(body) && !/featureGuard(Any)?\(/.test(body)) {
        await expect(call).rejects.toThrow(OFF.error)
      } else {
        const res = await call
        // Public checkout actions map the off result to a generic 404.
        const expected = PUBLIC_OFF.has(`${path.basename(file)}:${name}`)
          ? { error: PUBLIC_FEATURE_OFF_MESSAGE }
          : "ok" in (res as object) ? { ok: false, status: 404 } : OFF
        expect(res).toEqual(expect.objectContaining(expected))
      }
    } finally {
      ;(featureGuard as jest.Mock).mockResolvedValue(null)
      ;(featureGuardAny as jest.Mock).mockResolvedValue(null)
      ;(assertFeature as jest.Mock).mockResolvedValue(undefined)
      ;(auth as jest.Mock).mockReset()
    }
  })

  const authed = fns.filter((f) => !PUBLIC.has(`${path.basename(file)}:${f.name}`))
  if (authed.length) it.each(authed.map((f) => [f.name]))("%s rejects an anonymous caller before reading feature state", async (name) => {
    const mod = await import(toModule(file))
    ;(auth as jest.Mock).mockResolvedValue(null)
    ;(featureGuard as jest.Mock).mockResolvedValue(OFF)
    ;(featureGuardAny as jest.Mock).mockResolvedValue(OFF)
    ;(assertFeature as jest.Mock).mockRejectedValue(new Error(OFF.error))
    try {
      const res = await Promise.resolve(mod[name](...(ARGS[`${path.basename(file)}:${name}`] ?? []))).catch((e: Error) => e)
      expect(featureGuard).not.toHaveBeenCalled()
      expect(featureGuardAny).not.toHaveBeenCalled()
      expect(assertFeature).not.toHaveBeenCalled()
      expect(isFeatureOn).not.toHaveBeenCalled()
      expect(res instanceof Error ? res.message : JSON.stringify(res ?? null)).not.toContain(OFF.error)
    } finally {
      ;(featureGuard as jest.Mock).mockResolvedValue(null)
      ;(featureGuardAny as jest.Mock).mockResolvedValue(null)
      ;(assertFeature as jest.Mock).mockResolvedValue(undefined)
    }
  })
})
