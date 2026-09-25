import Link from "next/link"
import { findEntry } from "@/lib/whatsNew"

// Home-page footer. Reads the build-time version and shows that release's
// curated highlights inline, with a link to the full /whats-new history.
// Degrades to link-only when there is no entry for the running version.
export function WhatsNewFooter() {
  const entry = findEntry(process.env.NEXT_PUBLIC_APP_VERSION)

  return (
    <footer className="mt-8 border-t border-border pt-4 text-xs text-muted-foreground">
      {entry && entry.highlights.length > 0 && (
        <span>
          <span className="font-semibold">{entry.version}</span>{" "}
          {entry.highlights.join(" · ")}
          {" · "}
        </span>
      )}
      <Link href="/whats-new" className="text-primary hover:underline">
        See all updates →
      </Link>
    </footer>
  )
}
