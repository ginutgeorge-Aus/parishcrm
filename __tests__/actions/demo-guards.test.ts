/** @jest-environment node */
// Every blocked action must refuse in DEMO_MODE before touching auth or the DB.
// Arguments are dummies: the guard is the first statement, so nothing else runs.

jest.mock("@/auth", () => ({ auth: jest.fn(), signIn: jest.fn(), signOut: jest.fn() }))
jest.mock("@/lib/prisma", () => {
  const model = () => new Proxy({}, { get: () => jest.fn() })
  return { prisma: new Proxy({}, { get: (_t, k) => (k === "$transaction" ? jest.fn() : model()) }) }
})
jest.mock("@/lib/email", () => new Proxy({}, { get: () => jest.fn() }))
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn() }))
jest.mock("next/cache", () => ({ revalidatePath: jest.fn(), revalidateTag: jest.fn(), unstable_cache: (fn: unknown) => fn }))
jest.mock("next/headers", () => ({ cookies: jest.fn(), headers: jest.fn() }))
jest.mock("next/navigation", () => ({ redirect: jest.fn(), notFound: jest.fn() }))

import { auth } from "@/auth"
import { DEMO_ERROR } from "@/lib/demoMode"
import * as user from "@/lib/actions/user"
import * as totp from "@/lib/actions/totp"
import * as trusted from "@/lib/actions/trustedDevice"
import * as authActions from "@/lib/actions/auth"
import * as setup from "@/lib/actions/setup"
import * as settings from "@/lib/actions/settings"
import * as branding from "@/lib/actions/branding"
import * as templates from "@/lib/actions/emailTemplates"
import * as attachment from "@/lib/actions/transactionAttachment"
import { parseImageUpload } from "@/lib/actions/eventForm"

const fd = () => new FormData()
const anyArgs = (fn: (...a: any[]) => unknown) => fn(undefined, fd(), fd())

const CASES: Array<[string, () => Promise<unknown>]> = [
  ["createUser", () => anyArgs(user.createUser) as Promise<unknown>],
  ["updateUser", () => anyArgs(user.updateUser) as Promise<unknown>],
  ["unlockUser", () => anyArgs(user.unlockUser) as Promise<unknown>],
  ["resetUserTotp", () => anyArgs(user.resetUserTotp) as Promise<unknown>],
  ["deleteUser", () => anyArgs(user.deleteUser) as Promise<unknown>],
  ["resendWelcome", () => anyArgs(user.resendWelcome) as Promise<unknown>],
  ["startTotpEnrolment", () => anyArgs(totp.startTotpEnrolment) as Promise<unknown>],
  ["confirmTotpEnrolment", () => anyArgs(totp.confirmTotpEnrolment) as Promise<unknown>],
  ["cancelTotpEnrolment", () => anyArgs(totp.cancelTotpEnrolment) as Promise<unknown>],
  ["regenerateBackupCodes", () => anyArgs(totp.regenerateBackupCodes) as Promise<unknown>],
  ["disableTotp", () => anyArgs(totp.disableTotp) as Promise<unknown>],
  ["trustDevice", () => anyArgs(trusted.trustDevice) as Promise<unknown>],
  ["revokeTrustedDevice", () => anyArgs(trusted.revokeTrustedDevice) as Promise<unknown>],
  ["requestPasswordReset", () => anyArgs(authActions.requestPasswordReset) as Promise<unknown>],
  ["resetPassword", () => anyArgs(authActions.resetPassword) as Promise<unknown>],
  ["createFirstAdmin", () => setup.createFirstAdmin(fd()) as Promise<unknown>],
  ["upsertSetting", () => anyArgs(settings.upsertSetting) as Promise<unknown>],
  ["updateChurchInfo", () => anyArgs(settings.updateChurchInfo) as Promise<unknown>],
  ["updateBirthdayTemplate", () => anyArgs(settings.updateBirthdayTemplate) as Promise<unknown>],
  ["sendTestBirthdayEmail", () => anyArgs(settings.sendTestBirthdayEmail) as Promise<unknown>],
  ["updateAnniversaryTemplate", () => anyArgs(settings.updateAnniversaryTemplate) as Promise<unknown>],
  ["sendTestAnniversaryEmail", () => anyArgs(settings.sendTestAnniversaryEmail) as Promise<unknown>],
  ["updateAutoEmailFlags", () => anyArgs(settings.updateAutoEmailFlags) as Promise<unknown>],
  ["updatePettyCashCustodian", () => anyArgs(settings.updatePettyCashCustodian) as Promise<unknown>],
  ["updateLetterSettings", () => anyArgs(settings.updateLetterSettings) as Promise<unknown>],
  ["updateMembershipSettings", () => anyArgs(settings.updateMembershipSettings) as Promise<unknown>],
  ["uploadBranding", () => anyArgs(branding.uploadBranding) as Promise<unknown>],
  ["resetBranding", () => anyArgs(branding.resetBranding) as Promise<unknown>],
  ["updateEmailTemplate", () => anyArgs(templates.updateEmailTemplate) as Promise<unknown>],
  ["resetEmailTemplate", () => anyArgs(templates.resetEmailTemplate) as Promise<unknown>],
  ["sendTestEmail", () => anyArgs(templates.sendTestEmail) as Promise<unknown>],
  ["attachTransactionReceipt", () => anyArgs(attachment.attachTransactionReceipt) as Promise<unknown>],
  ["removeTransactionReceipt", () => anyArgs(attachment.removeTransactionReceipt) as Promise<unknown>],
]

describe("DEMO_MODE action guards", () => {
  beforeEach(() => { process.env.DEMO_MODE = "true"; jest.clearAllMocks() })
  afterEach(() => { delete process.env.DEMO_MODE })

  it.each(CASES)("%s refuses before auth", async (_name, call) => {
    const result = await call()
    expect(JSON.stringify(result)).toContain(DEMO_ERROR)
    expect(auth).not.toHaveBeenCalled()
  })

  it("parseImageUpload refuses a selected file but allows no-file submits", async () => {
    const withFile = new FormData()
    withFile.set("bannerFile", new File([new Uint8Array([1, 2, 3])], "b.png", { type: "image/png" }))
    expect(await parseImageUpload(withFile, "banner")).toEqual({ error: DEMO_ERROR })
    expect(await parseImageUpload(new FormData(), "banner")).toEqual({ op: "skip" })
  })
})
