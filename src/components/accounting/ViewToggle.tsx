"use client"

import { useRouter, useSearchParams } from "next/navigation"

type Props = {
  currentView: "annual" | "monthly"
  year: number
}

export function ViewToggle({ currentView, year }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function switchTo(view: "annual" | "monthly") {
    const params = new URLSearchParams(searchParams.toString())
    params.set("year", String(year))
    if (view === "monthly") {
      params.set("view", "monthly")
    } else {
      params.delete("view")
    }
    router.push(`?${params.toString()}`)
  }

  const active = "bg-primary text-primary-foreground"
  const inactive = "bg-background text-foreground hover:bg-accent"
  const transformTransition = "transition-transform duration-150 active:scale-[0.97] motion-reduce:active:scale-100"

  return (
    <div className="flex items-center divide-x divide-border border border-border rounded overflow-hidden">
      <button
        onClick={() => switchTo("annual")}
        aria-pressed={currentView === "annual"}
        className={`px-3 py-1 min-h-11 min-w-11 text-sm transition-colors ${currentView === "annual" ? active : inactive} ${transformTransition}`}
      >
        Annual
      </button>
      <button
        onClick={() => switchTo("monthly")}
        aria-pressed={currentView === "monthly"}
        className={`px-3 py-1 min-h-11 min-w-11 text-sm transition-colors ${currentView === "monthly" ? active : inactive} ${transformTransition}`}
      >
        Monthly
      </button>
    </div>
  )
}
