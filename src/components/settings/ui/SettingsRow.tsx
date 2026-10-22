import { Label } from "@/components/ui/label"

/**
 * Id of a row's description, for the control's `aria-describedby`.
 * @param htmlFor the control id passed to `SettingsRow`
 */
export function settingsDescId(htmlFor: string): string {
  return `${htmlFor}-desc`
}

/**
 * One setting: label + description on the left, control on the right (md+);
 * stacked and full width below md.
 * @param props.label setting name
 * @param props.description helper text
 * @param props.htmlFor id of the control, so the label is clickable; the
 *   description then gets `settingsDescId(htmlFor)` so the control can point
 *   `aria-describedby` at it
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
}: Readonly<{ label: React.ReactNode; description?: React.ReactNode; htmlFor?: string; children: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-3 py-5 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="md:max-w-[60%]">
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</Label>
        ) : (
          <p className="text-sm font-medium text-foreground">{label}</p>
        )}
        {description && (
          <p id={htmlFor ? settingsDescId(htmlFor) : undefined} className="mt-1 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="w-full md:w-auto md:min-w-0 md:shrink [&_input]:max-w-full [&_textarea]:max-w-full">{children}</div>
    </div>
  )
}
