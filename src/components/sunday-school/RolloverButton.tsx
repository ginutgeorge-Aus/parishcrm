"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { DeleteConfirmButton } from "@/components/shared/DeleteConfirmButton"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { rolloverYear } from "@/lib/actions/sundaySchool"

/**
 * One-time "roll over to next year": confirm, call rolloverYear, then show the
 * result and switch the list to the new year.
 */
export function RolloverButton({ fromYear, classCount }: Readonly<{ fromYear: number; classCount: number }>) {
  const router = useRouter()
  const [done, setDone] = useState<string | null>(null)
  const toYear = fromYear + 1

  return (
    <div className="space-y-1">
      <DeleteConfirmButton
        onConfirm={async () => {
          const r = await rolloverYear(fromYear)
          if (r && "success" in r) {
            setDone(r.success)
            router.push(`/sunday-school?year=${toYear}`)
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
      <FormFeedback state={done ? { success: done } : null} />
    </div>
  )
}
