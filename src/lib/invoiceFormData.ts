import { prisma } from "@/lib/prisma"
import { PERSON_PICKER_CAP } from "@/lib/constants"
import { getInvoiceSettings } from "@/lib/invoiceSettings"
import type { RecipientOption } from "@/components/accounting/RecipientPicker"

/** Lookup lists for the invoice editor: recipients (customers + members), income accounts, funds, GST flag. */
export async function loadInvoiceFormData() {
  const [people, customers, accounts, funds, settings] = await Promise.all([
    prisma.person.findMany({
      where: { archivedAt: null },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: PERSON_PICKER_CAP,
    }),
    prisma.customer.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.account.findMany({
      where: { type: "INCOME", isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    prisma.fund.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { sortOrder: "asc" } }),
    getInvoiceSettings(),
  ])
  const recipients: RecipientOption[] = [
    ...customers.map((c) => ({ kind: "customer" as const, id: c.id, name: c.name })),
    ...people.map((p) => ({ kind: "person" as const, id: p.id, name: `${p.firstName} ${p.lastName}` })),
  ]
  return {
    recipients,
    accounts: accounts.map((a) => ({ id: a.id, name: `${a.code} ${a.name}` })),
    funds,
    gstEnabled: settings.gstRegistered,
  }
}
