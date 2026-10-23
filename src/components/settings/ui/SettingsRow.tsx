import { Label } from "@/components/ui/label"

/**
 * Id of a row's description, for the control's `aria-describedby`.
 * @param htmlFor the control id passed to `SettingsRow`
 */
export function settingsDescId(htmlFor: string): string {
  return `${htmlFor}-desc`
}

/**
 * Joins ids into one `aria-describedby` value, dropping empty ones.
 * @param ids candidate ids (falsy entries are skipped)
 * @returns the space-separated list, or `undefined` when none remain
 */
export function joinDescribedBy(...ids: Array<string | false | null | undefined>): string | undefined {
  const kept = ids.filter(Boolean)
  return kept.length > 0 ? kept.join(" ") : undefined
}

/**
 * One setting: label + description on the left, control on the right (md+);
 * stacked and full width below md. `stacked` keeps the label, hint and a
 * full-width control in one column at every width (for textareas).
 * @param props.label setting name
 * @param props.description helper text
 * @param props.htmlFor id of the control, so the label is clickable; the
 *   description then gets `settingsDescId(htmlFor)`
 * @param props.stacked single-column layout at every width
 * @param props.children the control, or a render function that receives the
 *   description id (`undefined` when the row has no description or `htmlFor`)
 *   to pass as the control's `aria-describedby`, so it can't be forgotten
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  stacked = false,
  children,
}: Readonly<{
  label: React.ReactNode
  description?: React.ReactNode
  htmlFor?: string
  stacked?: boolean
  children: React.ReactNode | ((descId: string | undefined) => React.ReactNode)
}>) {
  const descId = htmlFor && description ? settingsDescId(htmlFor) : undefined
  return (
    <div
      className={
        stacked
          ? "flex flex-col gap-2 py-5"
          : "flex flex-col gap-3 py-5 md:flex-row md:items-center md:justify-between md:gap-8"
      }
    >
      <div className={stacked ? undefined : "md:max-w-[60%]"}>
        {htmlFor ? (
          <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">{label}</Label>
        ) : (
          <p className="text-sm font-medium text-foreground">{label}</p>
        )}
        {description && (
          <div id={descId} className="mt-1 text-sm text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <div
        className={
          stacked
            ? "w-full min-w-0"
            : "w-full md:w-auto md:min-w-0 md:shrink [&_input]:max-w-full [&_textarea]:max-w-full"
        }
      >
        {typeof children === "function" ? children(descId) : children}
      </div>
    </div>
  )
}
