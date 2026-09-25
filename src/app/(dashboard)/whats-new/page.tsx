import { WHATS_NEW } from "@/lib/whatsNew"

// Full release-notes history. All authenticated roles may view (no guard) —
// product news, no sensitive data. The (dashboard) layout enforces auth.
export default async function WhatsNewPage() {
  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold text-foreground mb-6">What&apos;s New</h2>

      {WHATS_NEW.length === 0 ? (
        <p className="text-sm text-muted-foreground">No release notes yet.</p>
      ) : (
        <ol className="space-y-6">
          {WHATS_NEW.map((e) => (
            <li key={e.version} className="border-b border-border pb-4">
              <div className="flex items-baseline gap-3">
                <span className="text-lg font-semibold text-foreground">{e.version}</span>
                <span className="text-xs text-muted-foreground">{e.date}</span>
              </div>
              <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground space-y-1">
                {e.highlights.map((h, i) => (
                  <li key={`${e.version}-${i}`}>{h}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
