import { Label } from "@/components/ui/label"

/**
 * One setting: label + description on the left, control on the right (md+);
 * stacked and full width below md.
 * @param props.label setting name
 * @param props.description helper text
 * @param props.htmlFor id of the control, so the label is clickable
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
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="w-full md:w-auto md:min-w-0 md:shrink [&_input]:max-w-full [&_textarea]:max-w-full">{children}</div>
    </div>
  )
}
