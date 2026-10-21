import { requireSettingsTab } from "@/lib/settingsAccess"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { ReceiptSettingsSection } from "@/components/settings/ReceiptSettingsSection"

/** Settings → Receipts: tax receipt wording and DGR details. */
export default async function ReceiptSettingsPage() {
  await requireSettingsTab("/settings/receipts")
  return <ReceiptSettingsSection settings={await getReceiptSettings()} />
}
