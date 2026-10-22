import { requireSettingsTab } from "@/lib/settingsAccess"
import { getReceiptSettings } from "@/lib/receiptSettings"
import { ReceiptSettingsSection } from "@/components/settings/ReceiptSettingsSection"

/** Settings → Receipts: tax receipt wording and DGR details. */
export default async function ReceiptSettingsPage() {
  const { data: settings } = await requireSettingsTab("/settings/receipts", getReceiptSettings)
  return <ReceiptSettingsSection settings={settings} />
}
