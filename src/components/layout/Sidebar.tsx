"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { logout } from "@/lib/actions/session"
import { Menu, X, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { FeedbackDialog } from "@/components/layout/FeedbackDialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { canAccessAccounting, canViewAccounting, canEdit, canManageUsers, canViewPeople as canViewPeopleRole, isAdmin as isAdminRole } from "@/lib/roleGuard"
import { buildNavGroups, flattenNavItems, type NavGroup } from "@/components/layout/sidebar/navData"
import { SidebarGroup } from "@/components/layout/sidebar/SidebarGroup"
import { SidebarLink } from "@/components/layout/sidebar/SidebarLink"

const OPEN_GROUPS_KEY = "sidebar-open-groups"
const RAIL_COLLAPSED_KEY = "sidebar-collapsed"

export function Sidebar({
  churchName,
  pendingUpdates = 0,
  verifyPending = 0,
  membershipPending = 0,
}: {
  churchName: string
  pendingUpdates?: number
  verifyPending?: number
  membershipPending?: number
}) {
  const pathname = usePathname()
  const { data: session } = useSession()
  const role = session?.user?.role

  const isAccounting = canAccessAccounting(role)
  const isAccountingViewer = canViewAccounting(role)
  const isAdmin = isAdminRole(role)
  const isEditor = canEdit(role)
  const canUsers = canManageUsers(role)
  const canViewPeople = canViewPeopleRole(role)

  const groups: NavGroup[] = useMemo(
    () =>
      buildNavGroups({
        isAccounting, isAccountingViewer, isAdmin, isEditor, canUsers, canViewPeople,
        pendingUpdates, verifyPending, membershipPending,
      }),
    [isAccounting, isAccountingViewer, isAdmin, isEditor, canUsers, canViewPeople, pendingUpdates, verifyPending, membershipPending]
  )

  // Highlight only the single most-specific matching item, so a parent path
  // ("/people", "/accounting", "/settings") no longer lights up alongside its
  // children on sub-pages. A path matches an item on an exact hit or a
  // separator-bounded prefix; the longest such href wins.
  const activeHref = useMemo(() => {
    const pathMatches = (href: string) =>
      href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/")
    return groups
      .flatMap((g) => flattenNavItems(g.items).filter((i) => i.show).map((i) => i.href))
      .filter(pathMatches)
      .reduce((best, h) => (h.length > best.length ? h : best), "")
  }, [groups, pathname])
  const isItemActive = (href: string) => href !== "" && href === activeHref

  const groupContainsActive = (group: NavGroup) =>
    flattenNavItems(group.items).some((item) => item.show && isItemActive(item.href))

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of groups) {
      init[g.label] = groupContainsActive(g)
    }
    return init
  })

  // Restore persisted open/close state on mount; never close the active group
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_GROUPS_KEY)
      if (!raw) return
      const persisted: unknown = JSON.parse(raw)
      // Guard the shape: a stale/tampered value that isn't a plain object must
      // not leak unexpected types into state.
      if (typeof persisted !== "object" || persisted === null || Array.isArray(persisted)) return
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpenGroups((prev) => {
        const next = { ...prev }
        for (const [label, isOpen] of Object.entries(persisted)) {
          if (label in next && !prev[label]) {
            next[label] = isOpen === true
          }
        }
        // Never leave the active group collapsed, even if persisted as closed —
        // a stale "closed" value must not hide the current page's group.
        for (const g of groups) {
          if (groupContainsActive(g)) next[g.label] = true
        }
        return next
      })
    } catch {}
    // Mount-only restore — `groups`/`groupContainsActive` are intentionally not
    // deps; we apply persisted state once, and the active-group force-open uses
    // the values current at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On a cold reload/deep-link, `useSession()` has no server-hydrated session,
  // so on first render `role` is undefined and every role-gated item is hidden —
  // the active group (e.g. Accounting on /accounting/*) then has no visible
  // items, so the mount-only restore above never force-opened it. Re-open the
  // active group whenever the set of active-group labels changes (i.e. once the
  // session resolves and those items appear), so the current page's group isn't
  // left collapsed. Keyed on the label set — not `groups` — so an
  // unrelated prop change (badge counts) can't re-open a group the user just
  // collapsed by hand.
  const activeGroupKey = groups
    .filter((g) => groupContainsActive(g))
    .map((g) => g.label)
    .join("|")
  useEffect(() => {
    if (!activeGroupKey) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOpenGroups((prev) => {
      let changed = false
      const next = { ...prev }
      for (const label of activeGroupKey.split("|")) {
        if (!next[label]) { next[label] = true; changed = true }
      }
      return changed ? next : prev
    })
  }, [activeGroupKey])

  function toggleGroup(label: string) {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  // Desktop-only icon rail. Defaults expanded so SSR/first paint never
  // mismatches a persisted value; the real state is restored after mount.
  const [railCollapsed, setRailCollapsed] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(RAIL_COLLAPSED_KEY) === "true") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRailCollapsed(true)
      }
    } catch {}
  }, [])

  function toggleRail() {
    setRailCollapsed((prev) => {
      const next = !prev
      try { localStorage.setItem(RAIL_COLLAPSED_KEY, String(next)) } catch {}
      return next
    })
  }

  const [mobileOpen, setMobileOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasOpenRef = useRef(false)

  // Close the mobile drawer on Escape so keyboard users aren't trapped.
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [mobileOpen])

  // Focus management: move focus into the drawer on open, restore it to
  // the trigger button on close, so keyboard users aren't dropped back at the
  // top of the document.
  useEffect(() => {
    if (mobileOpen) {
      closeButtonRef.current?.focus()
    } else if (wasOpenRef.current) {
      menuButtonRef.current?.focus()
    }
    wasOpenRef.current = mobileOpen
  }, [mobileOpen])

  // Trap Tab/Shift+Tab within the drawer while open, and mark the main content
  // region `inert` so background controls aren't reachable — required for a
  // `role="dialog" aria-modal="true"` per the WAI-ARIA APG.
  useEffect(() => {
    const mainEl = document.getElementById("main-content")
    if (!mobileOpen) {
      mainEl?.removeAttribute("inert")
      return
    }
    mainEl?.setAttribute("inert", "")

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab" || !drawerRef.current) return
      const focusables = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else if (document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      mainEl?.removeAttribute("inert")
    }
  }, [mobileOpen])

  const flatVisibleItems = useMemo(
    () => groups.flatMap((g) => flattenNavItems(g.items).filter((i) => i.show)),
    [groups]
  )

  function renderNavContent(collapsed: boolean) {
    return (
      <>
        <nav className={cn("flex-1 px-2 py-3 space-y-1 overflow-y-auto", collapsed && "flex flex-col items-center")}>
          {collapsed
            ? flatVisibleItems.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isItemActive(item.href)}
                  collapsed
                  onNavigate={() => setMobileOpen(false)}
                />
              ))
            : groups.map((group) => {
                const visibleItems = flattenNavItems(group.items).filter((i) => i.show)
                if (visibleItems.length === 0) return null
                return (
                  <SidebarGroup
                    key={group.label}
                    group={group}
                    isOpen={openGroups[group.label] ?? false}
                    hasActive={groupContainsActive(group)}
                    isActive={isItemActive}
                    onToggle={() => toggleGroup(group.label)}
                    onNavigate={() => setMobileOpen(false)}
                  />
                )
              })}
        </nav>
        <div className="px-3 py-4 border-t border-white/10 space-y-0.5">
          <FeedbackDialog collapsed={collapsed} />
          <button
            onClick={() => logout()}
            aria-label="Sign out"
            className={cn(
              "flex items-center gap-3 w-full rounded-md text-sm text-primary-foreground/70 hover:bg-white/10 hover:text-primary-foreground transition-colors",
              collapsed ? "justify-center px-2 py-2" : "px-3 py-2"
            )}
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && "Sign out"}
          </button>
        </div>
        {!collapsed && (
          <div className="px-6 py-3 border-t border-white/10">
            <p className="text-xs text-primary-foreground/60">
              {process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}
            </p>
          </div>
        )}
      </>
    )
  }

  return (
    <TooltipProvider>
      {/* Mobile top bar */}
      <div className="md:hidden print:hidden fixed top-0 left-0 right-0 h-14 bg-primary text-primary-foreground flex items-center px-4 z-40 border-b border-white/10">
        <button
          ref={menuButtonRef}
          onClick={() => setMobileOpen(true)}
          className="-ml-2.5 p-2.5 text-primary-foreground/60 hover:text-primary-foreground"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <span className="ml-2 flex items-center rounded bg-white p-0.5">
          <Image src="/api/branding/crest" alt="" width={128} height={145} className="h-9 w-auto" unoptimized />
        </span>
        <span className="ml-2.5 min-w-0 truncate font-display text-lg font-semibold tracking-tight text-primary-foreground">
          {churchName}
        </span>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          className="md:hidden fixed inset-0 bg-black/50 z-40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer — always fully expanded, unaffected by the desktop rail */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal={mobileOpen}
        aria-label="Navigation"
        // Drawer stays mounted (CSS-translated off-screen) when closed. Hide its
        // subtree from AT and the tab order so screen-reader/keyboard users can't
        // reach the nav while it's visually hidden.
        aria-hidden={!mobileOpen}
        inert={!mobileOpen}
        className={cn(
          "md:hidden fixed top-0 left-0 h-full w-56 bg-primary text-primary-foreground flex flex-col z-50 transition-transform duration-200 motion-reduce:transition-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="px-4 py-4 border-b border-white/10 flex items-start justify-between">
          <span className="rounded-lg bg-white p-2 shadow-sm">
            <Image src="/api/branding/logo" alt={churchName} width={512} height={466} className="h-24 w-auto" priority unoptimized />
          </span>
          <button
            ref={closeButtonRef}
            onClick={() => setMobileOpen(false)}
            className="-mr-2 p-2 text-primary-foreground/60 hover:text-primary-foreground"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {renderNavContent(false)}
      </div>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden md:flex print:hidden min-h-screen bg-primary text-primary-foreground flex-col transition-[width] duration-200",
          railCollapsed ? "w-16" : "w-56"
        )}
      >
        <div
          className={cn(
            "border-b border-white/10",
            railCollapsed
              ? "px-2 py-3 flex flex-col items-center gap-2"
              : "px-4 py-4 flex items-start justify-between"
          )}
        >
          {railCollapsed ? (
            <span className="rounded bg-white p-0.5">
              <Image src="/api/branding/crest" alt={churchName} width={128} height={145} className="h-9 w-auto" unoptimized />
            </span>
          ) : (
            <span className="rounded-lg bg-white p-2 shadow-sm">
              <Image src="/api/branding/logo" alt={churchName} width={512} height={466} className="h-24 w-auto" priority unoptimized />
            </span>
          )}
          <button
            onClick={toggleRail}
            aria-label={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="text-primary-foreground/60 hover:text-primary-foreground"
          >
            {railCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>
        {renderNavContent(railCollapsed)}
      </aside>
    </TooltipProvider>
  )
}
