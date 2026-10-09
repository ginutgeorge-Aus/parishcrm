/**
 * Wraps a decorative skeleton: the blocks stay aria-hidden while a polite
 * status tells assistive tech a load is in progress. No aria-busy — the region
 * unmounts rather than settling, so busy would suppress the announcement.
 */
export function LoadingStatus({ className, children }: Readonly<{ className?: string; children: React.ReactNode }>) {
  return (
    <div role="status">
      <span className="sr-only">Loading…</span>
      <div className={className} aria-hidden="true">
        {children}
      </div>
    </div>
  )
}
