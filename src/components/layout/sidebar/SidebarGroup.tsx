import { useId } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { SidebarLink } from "@/components/layout/sidebar/SidebarLink"
import { pendingTotal, type NavGroup, type NavEntry } from "@/components/layout/sidebar/navData"

export function SidebarGroup({
  group,
  isOpen,
  hasActive,
  isActive,
  onToggle,
  onNavigate,
}: Readonly<{
  group: NavGroup
  isOpen: boolean
  hasActive: boolean
  isActive: (href: string) => boolean
  onToggle: () => void
  onNavigate: () => void
}>) {
  // useId, not a label slug: the nav renders twice (mobile drawer + desktop
  // aside), so a slug id would be duplicated and aria-controls ambiguous.
  const panelId = useId()

  const entries = group.items.map((entry) => (
    <SidebarEntry
      key={"subLabel" in entry ? entry.subLabel : entry.href}
      entry={entry}
      isActive={isActive}
      onNavigate={onNavigate}
    />
  ))

  if (group.headless) return <div className="space-y-0.5 pb-2">{entries}</div>

  // Surface pending counts on the header while collapsed, so an actionable
  // badge on a hidden link (Family Updates, Membership Forms…) isn't lost.
  // Informational badges (Release Checks) stay out of the total.
  const pending = pendingTotal(group.items)

  const Icon = group.icon

  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-muted",
          hasActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
        )}
      >
        {Icon ? <Icon className="w-4 h-4 shrink-0" aria-hidden="true" /> : null}
        <span className="flex flex-1 items-center gap-2">
          {group.label}
          {!isOpen && pending > 0 ? (
            <span className="rounded-full bg-warning px-1.5 text-[10px] font-semibold text-warning-foreground">
              {pending}<span className="sr-only"> pending</span>
            </span>
          ) : null}
        </span>
        <ChevronRight
          className={cn("w-4 h-4 transition-transform motion-reduce:transition-none", isOpen && "rotate-90")}
          aria-hidden="true"
        />
      </button>

      {/* Always rendered so aria-controls resolves while collapsed. Indented
          with a guide line so sub-items read as children of the header. */}
      <div id={panelId} hidden={!isOpen} className="mt-0.5 ml-[1.125rem] space-y-0.5 border-l border-border pl-2">
        {entries}
      </div>
    </div>
  )
}

function SidebarEntry({
  entry,
  isActive,
  onNavigate,
}: Readonly<{
  entry: NavEntry
  isActive: (href: string) => boolean
  onNavigate: () => void
}>) {
  if ("subLabel" in entry) {
    const visible = entry.items.filter((i) => i.show)
    if (visible.length === 0) return null
    return (
      <div>
        <p className="px-3 pt-2 pb-0.5 text-[11px] uppercase tracking-wide text-muted-foreground/70">
          {entry.subLabel}
        </p>
        {visible.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            active={isActive(item.href)}
            collapsed={false}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    )
  }

  if (!entry.show) return null
  return (
    <SidebarLink item={entry} active={isActive(entry.href)} collapsed={false} onNavigate={onNavigate} />
  )
}
