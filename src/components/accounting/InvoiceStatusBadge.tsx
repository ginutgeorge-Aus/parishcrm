import { Badge } from "@/components/ui/badge"
import type { InvoiceStatus } from "@/lib/generated/prisma/enums"

const LABEL: Record<InvoiceStatus, string> = { DRAFT: "Draft", SENT: "Sent", PAID: "Paid", VOID: "Void" }
const VARIANT: Record<InvoiceStatus, "secondary" | "default" | "outline" | "destructive"> = {
  DRAFT: "secondary", SENT: "default", PAID: "outline", VOID: "destructive",
}

/** Coloured status pill for an invoice. */
export function InvoiceStatusBadge({ status }: Readonly<{ status: InvoiceStatus }>) {
  return <Badge variant={VARIANT[status]}>{LABEL[status]}</Badge>
}
