"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { activeHref } from "@/components/layout/activeHref"
import type { SettingsTabGroup } from "@/lib/settingsTabs"
import { DISCARD_PROMPT, useUnsavedChanges } from "./unsavedChanges"

/**
 * Settings area tab list: a sticky grouped list on md+, a full-width Select
 * below md. Desktop links are guarded by `UnsavedChangesProvider`'s link-click
 * listener; the Select has no link, so it confirms itself in `confirmLeave`.
 * @param props.groups visible tab groups (from `buildSettingsTabs`)
 * @returns the mobile Select and the desktop nav
 */
export function SettingsTabs({ groups }: Readonly<{ groups: readonly SettingsTabGroup[] }>) {
  const pathname = usePathname()
  const router = useRouter()
  const { hasUnsaved } = useUnsavedChanges()
  const active = activeHref(pathname, groups.flatMap((g) => g.tabs.map((t) => t.href)))

  /**
   * Mobile Select change: confirms leaving if a form is dirty, then pushes.
   * @param href target tab
   */
  const confirmLeave = (href: string) => {
    if (href === active) return
    if (hasUnsaved() && !window.confirm(DISCARD_PROMPT)) return
    router.push(href)
  }

  return (
    <>
      <div className="md:hidden">
        <Select value={active ?? undefined} onValueChange={confirmLeave}>
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
