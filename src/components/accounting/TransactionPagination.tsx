import Link from "next/link"
import { Button } from "@/components/ui/button"
import type { TransactionsSearchParams } from "@/lib/reports/transactionsQuery"

type Props = {
  searchParams: TransactionsSearchParams
  page: number
  totalPages: number
}

export function TransactionPagination({ searchParams, page, totalPages }: Props) {
  function pageHref(p: number) {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) params.set(k, v)
    }
    if (p > 1) params.set("page", String(p))
    else params.delete("page")
    const qs = params.toString()
    return qs ? `/accounting/transactions?${qs}` : "/accounting/transactions"
  }

  const windowSize = 2
  const pageWindow: number[] = []
  for (let p = Math.max(1, page - windowSize); p <= Math.min(totalPages, page + windowSize); p++) {
    pageWindow.push(p)
  }

  if (totalPages <= 1) return null

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        {page > 1 ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={pageHref(page - 1)}>Previous</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Previous</Button>
        )}
        {pageWindow[0] > 1 && (
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={pageHref(1)}>1</Link>
            </Button>
            {pageWindow[0] > 2 && <span className="px-1 text-muted-foreground">…</span>}
          </>
        )}
        {pageWindow.map((p) => (
          <Button key={p} variant={p === page ? "default" : "outline"} size="sm" asChild>
            <Link href={pageHref(p)}>{p}</Link>
          </Button>
        ))}
        {pageWindow[pageWindow.length - 1] < totalPages && (
          <>
            {pageWindow[pageWindow.length - 1] < totalPages - 1 && <span className="px-1 text-muted-foreground">…</span>}
            <Button variant="outline" size="sm" asChild>
              <Link href={pageHref(totalPages)}>{totalPages}</Link>
            </Button>
          </>
        )}
        {page < totalPages ? (
          <Button variant="outline" size="sm" asChild>
            <Link href={pageHref(page + 1)}>Next</Link>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>Next</Button>
        )}
      </div>
    </div>
  )
}
