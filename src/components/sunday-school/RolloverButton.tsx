"use client"

import { useRouter } from "next/navigation"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { rolloverYear } from "@/lib/actions/sundaySchool"

/**
 * One-time "roll over to next year": confirm, call rolloverYear, then switch the
 * list to the new year. The summary rides along as `?rolled=` because this
 * button is gone after the refresh, and may not render on the new year's page.
 */
export function RolloverButton({ fromYear, classCount }: Readonly<{ fromYear: number; classCount: number }>) {
  const router = useRouter()
  const toYear = fromYear + 1

  return (
    <DeleteConfirmButton
      onConfirm={async () => {
        const r = await rolloverYear(fromYear)
        if (r && "success" in r) {
          router.push(`/sunday-school?year=${toYear}&rolled=${encodeURIComponent(r.success)}`)
          return
        }
        return r
      }}
      title={`Roll over to ${toYear}?`}
      description={`Copy all ${classCount} classes and their teachers into ${toYear}, and move each child up one level at the same location? Children in the top class, or where more than one next-level class exists, stay unenrolled for you to place.`}
      triggerLabel={`Roll over to ${toYear}`}
      triggerVariant="outline"
      triggerClassName="min-h-11 sm:min-h-0"
      confirmLabel="Roll over"
      pendingLabel="Rolling over…"
    />
  )
}
