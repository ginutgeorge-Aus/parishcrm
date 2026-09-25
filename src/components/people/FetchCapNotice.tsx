import { PERSON_FETCH_CAP } from "@/lib/constants"

// Shown when a celebration scan hit PERSON_FETCH_CAP, so a missing name reads as
// "list truncated", not "no birthday/anniversary".
export function FetchCapNotice({ className = "" }: { className?: string }) {
  return (
    <p role="status" className={`text-xs text-destructive ${className}`}>
      This list may be incomplete — only the first {PERSON_FETCH_CAP.toLocaleString()} records were checked.
    </p>
  )
}
