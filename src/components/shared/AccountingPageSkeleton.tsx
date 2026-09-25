// Shared loading skeleton for accounting pages whose Server Components run
// several sequential DB queries — shown via route-level loading.tsx so the
// user sees structured placeholders instead of a blank flash on navigation /
// after revalidation.
// Delegates to ListPageSkeleton with h-10 rows (denser table rows vs h-12
// card-style rows used by list pages) — deduped in.
import { ListPageSkeleton } from "@/components/shared/ListPageSkeleton"

export function AccountingPageSkeleton({ rows = 8 }: { rows?: number }) {
  return <ListPageSkeleton rows={rows} rowHeight="h-10" />
}
