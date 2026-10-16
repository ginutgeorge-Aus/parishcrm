import Link from "next/link"
import { CheckCircle2, ChevronRight } from "lucide-react"
import type { AttentionItem } from "@/lib/dashboardAttention"

/**
 * The dashboard's lead section: what needs the viewer today. One full-width,
 * 44px+ tappable row per pending item (label, count — "N+" when the count is
 * a lower bound — and a link to the page that resolves it), or a calm "All
 * caught up" line when nothing is pending.
 *
 * @param items - Already role-filtered, non-zero items from `buildAttentionItems`.
 */
export function NeedsAttention({ items }: Readonly<{ items: AttentionItem[] }>) {
  return (
    <section aria-labelledby="needs-attention-heading" className="space-y-3">
      <h2 id="needs-attention-heading" className="text-lg font-semibold">
        Needs attention
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
          All caught up — nothing needs you right now.
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="flex min-h-11 items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none motion-reduce:transition-none"
              >
                <span className="min-w-[2.5rem] rounded-full bg-gold px-2 py-0.5 text-center font-semibold tabular text-gold-foreground">
                  {item.count}
                  {item.atLeast && "+"}
                </span>
                <span className="flex-1 font-medium">{item.label}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
