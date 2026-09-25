import { Badge } from "@/components/ui/badge"
import { computeRiskFlags, type RiskFlaggable } from "@/lib/reports/riskFlags"

type Props = {
  tx: RiskFlaggable
  className?: string
}

/**
 * Renders computed fraud/risk badges for a transaction — large amount,
 * backdated entry, edited-after-posting. No persisted state; purely derived
 * from `computeRiskFlags`. Server-renderable (no client interactivity).
 */
export function RiskFlagBadges({ tx, className }: Props) {
  const flags = computeRiskFlags(tx)
  if (flags.length === 0) return null

  return (
    <span className={className ? `inline-flex flex-wrap gap-1 ${className}` : "inline-flex flex-wrap gap-1"}>
      {flags.map((flag) => (
        <Badge
          key={flag.type}
          variant="outline"
          className="border-transparent bg-gold/10 text-gold-foreground"
          title={flag.description}
          aria-label={`Risk flag: ${flag.label} — ${flag.description}`}
        >
          {flag.label}
        </Badge>
      ))}
    </span>
  )
}
