import { z } from "zod"
import type { BankAccount, LetterSettings } from "@/lib/letterSettings"

export type WelcomeLetterModel = {
  date: string
  addresseeName: string
  addressLines: string[]
  greetingName: string
  memberNo: string | null
  includeTransfer: boolean
  transferChurch: string
  members: string[]
  bodyIntro: string
  contributionsIntro: string
  bodyClosing: string
  bankAccounts: BankAccount[]
  signerName: string
  signerTitle: string
  church: { name: string; address: string; abn: string; email: string }
}

// Bound every field before it reaches pdfkit — any canEdit user can POST here,
// so an unbounded/malformed payload must not throw a 500 or render a huge PDF.
const BankAccountSchema = z.object({
  fundLabel: z.string().max(120),
  bank: z.string().max(100),
  bsb: z.string().max(20),
  account: z.string().max(30),
  accountName: z.string().max(120),
  taxDeductible: z.boolean(),
})

export const ModelSchema = z.object({
  date: z.string().max(40),
  addresseeName: z.string().max(200),
  addressLines: z.array(z.string().max(200)).max(10),
  greetingName: z.string().max(200),
  memberNo: z.string().max(40).nullable(),
  includeTransfer: z.boolean(),
  transferChurch: z.string().max(200),
  members: z.array(z.string().max(200)).max(30),
  bodyIntro: z.string().max(8000),
  contributionsIntro: z.string().max(4000),
  bodyClosing: z.string().max(4000),
  bankAccounts: z.array(BankAccountSchema).max(4),
  signerName: z.string().max(120),
  signerTitle: z.string().max(120),
  church: z.object({
    name: z.string().max(200),
    address: z.string().max(200),
    abn: z.string().max(40),
    email: z.string().max(200),
  }),
})

type NameParts = {
  title: string | null
  firstName: string
  middleName: string | null
  lastName: string
  suffix: string | null
  motherParish?: string | null
}

export type BuildInput = {
  family: { memberNo: string | null; address: string | null; suburb: string | null; state: string | null; postcode: string | null }
  members: NameParts[] // pre-ordered by role asc (HEAD first)
  settings: LetterSettings
  church: { name: string; address: string; abn: string; email: string }
  today: string
  parishFields: boolean
}

export function fullName(p: NameParts): string {
  return [p.title, p.firstName, p.middleName, p.lastName, p.suffix].filter(Boolean).join(" ")
}

export const DEFAULT_INTRO =
  "On behalf of everyone at {churchName}, we warmly welcome you and your family.\n\nWe pray that {churchName} will be a place where your family grows in faith and experiences Christian fellowship. We encourage you to take part in our worship services and church activities."

export const DEFAULT_CONTRIBUTIONS =
  "We kindly request that your regular contributions and other donations be made by bank transfer using the church account details below."

export const DEFAULT_CLOSING =
  "Once again, we extend our heartfelt welcome to your family. May God richly bless you, guide you, and use you in His service as part of our church family."

// Only the known placeholders are substituted; any other {token} is left as-is
// so an admin typo is visible in the draft rather than silently blanked.
export function fillTemplate(tpl: string, vars: { churchName: string; memberNo: string }): string {
  return tpl.replace(/\{(churchName|memberNo)\}/g, (_, k: "churchName" | "memberNo") => vars[k])
}

// Intro = template paragraphs with the generated enrol/transfer sentence
// inserted after the first paragraph (its position in the original letter).
function buildIntro(template: string, churchName: string, includeTransfer: boolean, transferChurch: string, memberNo: string): string {
  const paras = fillTemplate(template.trim() || DEFAULT_INTRO, { churchName, memberNo }).split(/\n\s*\n/)
  const enrolNo = memberNo ? ` as Membership No. ${memberNo}` : ""
  const enrol = includeTransfer
    ? `We are pleased to receive your transfer letter from ${transferChurch}, and your family has been enrolled as members${enrolNo}.`
    : `Your family has been enrolled as members${enrolNo}.`
  paras.splice(1, 0, enrol)
  return paras.join("\n\n")
}

export function buildWelcomeLetterModel(input: BuildInput): WelcomeLetterModel {
  const { family, members, settings, church, today, parishFields } = input
  const head = members[0]
  const includeTransfer = parishFields && members.some((m) => m.motherParish?.trim())
  const transferChurch = members.find((m) => m.motherParish?.trim())?.motherParish?.trim() ?? ""

  const memberNo = family.memberNo?.trim() ?? ""

  const cityLine = [family.suburb, family.state, family.postcode].filter(Boolean).join(" ")
  const addressLines = [family.address, cityLine].filter((l): l is string => !!l && l.trim().length > 0)

  const addresseeName = head
    ? `${[head.title, head.firstName, head.lastName].filter(Boolean).join(" ")} & Family`
    : ""

  return {
    date: today,
    addresseeName,
    addressLines,
    greetingName: head ? fullName(head) : "",
    memberNo: family.memberNo,
    includeTransfer,
    transferChurch,
    members: members.map(fullName),
    bodyIntro: buildIntro(settings.introTemplate, church.name, includeTransfer, transferChurch, memberNo),
    contributionsIntro: fillTemplate(settings.contributionsTemplate.trim() || DEFAULT_CONTRIBUTIONS, { churchName: church.name, memberNo }),
    bodyClosing: fillTemplate(settings.closingTemplate.trim() || DEFAULT_CLOSING, { churchName: church.name, memberNo }),
    bankAccounts: [settings.general, settings.building],
    signerName: settings.signerName,
    signerTitle: settings.signerTitle,
    church,
  }
}
