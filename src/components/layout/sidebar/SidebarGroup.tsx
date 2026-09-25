import { ChevronDown, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { SidebarLink } from "@/components/layout/sidebar/SidebarLink"
import type { NavGroup, NavEntry } from "@/components/layout/sidebar/navData"

export function SidebarGroup({
  group,
  isOpen,
  hasActive,
  isActive,
  onToggle,
  onNavigate,
}: {
  group: NavGroup
  isOpen: boolean
  hasActive: boolean
  isActive: (href: string) => boolean
  onToggle: () => void
  onNavigate: () => void
}) {
  const panelId = `sidebar-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`

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
        {group.label}
        {isOpen
          ? <ChevronDown className="w-3 h-3" aria-hidden="true" />
          : <ChevronRight className="w-3 h-3" aria-hidden="true" />
        }
      </button>

      {isOpen && (
        <div id={panelId} className="mt-0.5 space-y-0.5">
          {group.items.map((entry) => (
            <SidebarEntry
              key={"subLabel" in entry ? entry.subLabel : entry.href}
              entry={entry}
              isActive={isActive}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarEntry({
  entry,
  isActive,
  onNavigate,
}: {
  entry: NavEntry
  isActive: (href: string) => boolean
  onNavigate: () => void
}) {
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
