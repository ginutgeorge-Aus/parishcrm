import { useId } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
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

  // Surface pending counts on the header while collapsed, so a badge on a
  // hidden link (Family Updates, Release Checks…) isn't lost.
  const pending = pendingTotal(group.items)

  return (
    <div>
      <button
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className={cn(
          "w-full flex items-center justify-between px-3 py-1.5 rounded-md text-xs font-semibold uppercase tracking-wider transition-colors",
          hasActive ? "text-primary-foreground" : "text-primary-foreground/70 hover:text-primary-foreground/90"
        )}
      >
        <span className="flex items-center gap-2">
          {group.label}
          {!isOpen && pending > 0 ? (
            <span className="rounded-full bg-warning px-1.5 text-[10px] font-semibold normal-case tracking-normal text-warning-foreground">
              {pending}<span className="sr-only"> pending</span>
            </span>
          ) : null}
        </span>
        {isOpen
          ? <ChevronDown className="w-3 h-3" aria-hidden="true" />
          : <ChevronRight className="w-3 h-3" aria-hidden="true" />
        }
      </button>

      {/* Always rendered so aria-controls resolves while collapsed. */}
      <div id={panelId} hidden={!isOpen} className="mt-0.5 space-y-0.5">
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
        <p className="px-3 pt-2 pb-0.5 text-[11px] uppercase tracking-wide text-primary-foreground/50">
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
