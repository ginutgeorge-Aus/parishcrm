/**
 * A titled, bordered box of `SettingsRow`s inside a card (email templates,
 * receipt sub-settings, nested feature toggles).
 * @param props.title subgroup heading
 * @param props.description helper text under the heading
 */
export function SettingsSubgroup({
  title,
  description,
  children,
}: Readonly<{ title: string; description?: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="py-5">
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      <div className="mt-3 divide-y divide-border rounded-lg border border-border px-4">{children}</div>
    </div>
  )
}
