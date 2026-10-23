import { LoadingStatus } from "@/components/shared/LoadingStatus"

/**
 * Loading placeholder for a settings tab: one card shaped like `SettingsCard`
 * (title, subtitle, divided rows). No page heading — the settings layout's
 * real "Settings" title and tab list stay visible around it.
 * @param props.rows number of row placeholders
 */
export function SettingsCardSkeleton({ rows = 5 }: Readonly<{ rows?: number }>) {
  return (
    <LoadingStatus className="rounded-xl border border-border bg-card">
      <div className="space-y-2 p-6">
        <div className="h-7 w-48 rounded bg-muted motion-safe:animate-pulse" />
        <div className="h-4 w-72 max-w-full rounded bg-muted motion-safe:animate-pulse" />
      </div>
      <div className="divide-y divide-border border-t border-border px-6">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="py-5">
            <div className="h-9 w-full rounded bg-muted motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </LoadingStatus>
  )
}
