/**
 * One settings tab's card: big title + subtitle, a divided body of rows, and
 * an optional right-aligned footer (usually the Save button). Wrap the card in
 * the `<form>` when the footer submits it.
 * @param props.title card heading (also the region's accessible name)
 * @param props.description subtitle under the heading
 * @param props.footer footer content, e.g. a submit button
 */
export function SettingsCard({
  title,
  description,
  children,
  footer,
}: Readonly<{ title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }>) {
  return (
    <section aria-label={title} className="rounded-xl border border-border bg-card">
      <div className="p-6">
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="divide-y divide-border border-t border-border px-6">{children}</div>
      {footer && <div className="flex justify-end border-t border-border p-4">{footer}</div>}
    </section>
  )
}
