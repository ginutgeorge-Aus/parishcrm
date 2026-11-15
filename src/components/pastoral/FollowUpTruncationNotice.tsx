import { FOLLOW_UP_LIST_MAX } from "@/lib/pastoralAccess"

/**
 * Notice shown when a follow-up list read matched more rows than the cap, so a
 * missing task reads as "list truncated". Renders nothing otherwise. Shared by the
 * /follow-ups page and the person/family card so the wording stays in one place.
 * @param truncated `truncated` flag from `listFollowUpTasks`
 * @param hint what to do next; defaults to the /follow-ups filter advice, the
 *   person/family card (no filters) passes its own
 */
export function FollowUpTruncationNotice({
  truncated,
  hint = "Narrow the filters to see the rest.",
}: Readonly<{ truncated?: boolean; hint?: string }>) {
  if (!truncated) return null
  return (
    <p role="status" className="text-sm text-muted-foreground">
      Showing the first {FOLLOW_UP_LIST_MAX}. {hint}
    </p>
  )
}
