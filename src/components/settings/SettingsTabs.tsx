"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { activeSettingsHref, type SettingsTabGroup } from "./settingsTabs"
import { DISCARD_PROMPT, useUnsavedChanges } from "./unsavedChanges"

/**
 * Settings area tab list: a sticky grouped list on md+, a full-width Select
 * below md. Both paths go through one `confirmLeave`, so unsaved edits are
 * never dropped silently.
 * @param props.groups visible tab groups (from `buildSettingsTabs`)
 * @returns the mobile Select and the desktop nav
 */
export function SettingsTabs({ groups }: Readonly<{ groups: readonly SettingsTabGroup[] }>) {
  const pathname = usePathname()
  const router = useRouter()
  const { hasUnsaved } = useUnsavedChanges()
  const active = activeSettingsHref(pathname, groups.flatMap((g) => g.tabs.map((t) => t.href)))

  /**
   * Confirms leaving the current tab if a form is dirty. With an event (link
   * click) it cancels the click on "Cancel"; without one (Select) it pushes.
   * @param href target tab
   * @param event the link click, when navigating by link
   */
  const confirmLeave = (href: string, event?: React.MouseEvent) => {
    if (href === active) return
    if (hasUnsaved() && !window.confirm(DISCARD_PROMPT)) {
      event?.preventDefault()
      return
    }
    if (!event) router.push(href)
  }

  return (
    <>
      <div className="md:hidden">
        <Select value={active ?? undefined} onValueChange={(href) => confirmLeave(href)}>
          <SelectTrigger aria-label="Settings section" className="w-full">
            <SelectValue placeholder="Settings section" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectGroup key={g.label}>
                <SelectLabel>{g.label}</SelectLabel>
                {g.tabs.map((t) => (
                  <SelectItem key={t.href} value={t.href}>{t.label}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Settings sections" className="sticky top-[4.5rem] hidden w-[220px] shrink-0 space-y-5 self-start md:block">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="px-3 pb-1 text-xs uppercase text-muted-foreground">{g.label}</p>
            <ul className="space-y-0.5">
              {g.tabs.map((t) => {
                const isActive = t.href === active
                return (
                  <li key={t.href}>
                    <Link
                      href={t.href}
                      aria-current={isActive ? "page" : undefined}
                      onClick={(e) => confirmLeave(t.href, e)}
                      className={cn(
                        "block rounded-md px-3 py-2 text-sm",
                        isActive ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </>
  )
}
