/** One jump-link target on the settings page. */
export type SettingsNavItem = { id: string; label: string }

/** Section ids/labels, in on-page order. The page wraps each group in `<section id={id}>`. */
export const SETTINGS_NAV_ITEMS: readonly SettingsNavItem[] = [
  { id: "general", label: "General" },
  { id: "branding", label: "Branding" },
  { id: "email", label: "Email" },
  { id: "members", label: "Members" },
  { id: "receipts", label: "Receipts" },
  { id: "security", label: "Security" },
]

/**
 * Sticky in-page anchor nav for the settings page. Plain `#hash` links (not tabs)
 * so every form stays mounted and unsaved edits survive navigation. Scrolls
 * horizontally on narrow screens instead of wrapping.
 */
export function SettingsNav({ items = SETTINGS_NAV_ITEMS }: Readonly<{ items?: readonly SettingsNavItem[] }>) {
  return (
    <nav
      aria-label="Settings sections"
      className="sticky top-0 z-10 -mx-1 mb-6 overflow-x-auto border-b border-border bg-background px-1 py-2"
    >
      <ul className="flex gap-1 whitespace-nowrap">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="inline-block rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
