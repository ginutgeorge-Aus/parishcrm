"use client"

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react"

export const DISCARD_PROMPT = "Discard unsaved changes?"

type Registry = Readonly<{ set: (id: string, dirty: boolean) => void; hasUnsaved: () => boolean }>
const UnsavedContext = createContext<Registry | null>(null)

/**
 * Whether a click on `anchor` would client-navigate away from this page: a
 * plain primary click on a same-origin link to another path or query.
 * Modified clicks, new-window/download links and in-page hashes keep this page.
 * @param e the click
 * @param anchor the clicked link
 * @returns true when the click leaves the current page in this tab
 */
function leavesPage(e: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return false
  let url: URL
  try {
    url = new URL(anchor.href, window.location.href)
  } catch {
    return false // malformed href: let the browser handle it, never throw from the capture listener
  }
  // Cross-origin links do a full page load, which `beforeunload` already guards.
  if (url.origin !== window.location.origin) return false
  return url.pathname !== window.location.pathname || url.search !== window.location.search
}

/**
 * Strips the fragment so hash-only traversals compare equal.
 * @param href absolute or relative URL
 * @returns origin + pathname + search
 */
function withoutHash(href: string): string {
  const u = new URL(href, window.location.href)
  return u.origin + u.pathname + u.search
}

/**
 * Holds which settings forms on the current page have unsaved edits. While any
 * is dirty, a click on any link that leaves the page (tab list, sidebar, top
 * bar, in-page links) asks before navigating. It listens in the document
 * capture phase so a cancel stops Next's `<Link>` handler too. Browser
 * Back/Forward (`popstate`) asks too; on cancel the dirty history entry is restored.
 * @param props.children settings tabs + page
 */
export function UnsavedChangesProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const dirtyIds = useRef(new Set<string>())
  const dirtyUrl = useRef("")
  const dirtyState = useRef<unknown>(null)
  const dirtyIndex = useRef<number | null>(null)
  const restoring = useRef(false)
  const restoreTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    /**
     * Back/Forward while dirty: confirm, else stop Next's handler and put the
     * user back on the dirty entry. Hash-only traversals stay on the page and
     * never prompt (URLs are compared without the fragment).
     * Preferred restore: with the Navigation API, `history.go(dirtyIndex - currentIndex)`
     * returns to the exact entry, so Forward entries and the stack are untouched;
     * the popstate that traversal fires is swallowed via `restoring` (only if it
     * landed on the dirty entry; the flag also expires after 500ms if no popstate comes).
     * Fallback (no Navigation API): `pushState` re-adds the dirty URL with the
     * state captured when the form became dirty (not the destination's state,
     * which holds the other page's router tree). Trade-off: it adds one history
     * entry and discards any Forward entries.
     * Ordering: in the DOM spec's event dispatch, capture listeners run before
     * non-capture ones even when the target is the window itself, so this runs
     * before Next's popstate listener and stopImmediatePropagation blocks it.
     */
    const onPopState = (e: PopStateEvent) => {
      if (restoring.current) {
        const landed = window.navigation?.currentEntry?.index
        restoring.current = false
        clearTimeout(restoreTimer.current)
        if (landed == null || landed === dirtyIndex.current) {
          e.stopImmediatePropagation()
          return
        }
      }
      if (dirtyIds.current.size === 0 || withoutHash(window.location.href) === withoutHash(dirtyUrl.current)) return
      if (window.confirm(DISCARD_PROMPT)) return
      e.stopImmediatePropagation()
      const current = window.navigation?.currentEntry?.index
      const delta = dirtyIndex.current !== null && current != null ? dirtyIndex.current - current : 0
      if (delta !== 0) {
        restoring.current = true
        // If go() fires no popstate (e.g. the target entry is gone), don't swallow the next real one.
        clearTimeout(restoreTimer.current)
        restoreTimer.current = setTimeout(() => { restoring.current = false }, 500)
        window.history.go(delta)
      } else {
        window.history.pushState(dirtyState.current, "", dirtyUrl.current)
      }
    }
    window.addEventListener("popstate", onPopState, true)
    const onClick = (e: MouseEvent) => {
      if (dirtyIds.current.size === 0 || e.defaultPrevented) return
      const anchor = (e.target as Element | null)?.closest?.("a[href]")
      if (!(anchor instanceof HTMLAnchorElement) || !leavesPage(e, anchor)) return
      if (!window.confirm(DISCARD_PROMPT)) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    document.addEventListener("click", onClick, true)
    return () => {
      document.removeEventListener("click", onClick, true)
      window.removeEventListener("popstate", onPopState, true)
    }
  }, [])
  const value = useMemo<Registry>(
    () => ({
      set: (id, dirty) => {
        if (dirty) {
          if (dirtyIds.current.size === 0) {
            dirtyUrl.current = window.location.href
            dirtyState.current = window.history.state
            dirtyIndex.current = window.navigation?.currentEntry?.index ?? null
          }
          dirtyIds.current.add(id)
        } else dirtyIds.current.delete(id)
      },
      hasUnsaved: () => dirtyIds.current.size > 0,
    }),
    [],
  )
  return <UnsavedContext value={value}>{children}</UnsavedContext>
}

/**
 * Read side for the tab list: `hasUnsaved()` is false outside a provider.
 * @returns an object with `hasUnsaved`, which reports whether any registered form is dirty
 */
export function useUnsavedChanges(): Readonly<{ hasUnsaved: () => boolean }> {
  const ctx = useContext(UnsavedContext)
  return { hasUnsaved: ctx?.hasUnsaved ?? (() => false) }
}

/**
 * Registers this form's dirty state and, while dirty, asks the browser to
 * confirm reloads/closes (`beforeunload`). Unregisters on unmount.
 * @param dirty whether the form has unsaved edits
 */
export function useUnsavedGuard(dirty: boolean): void {
  const ctx = useContext(UnsavedContext)
  const id = useId()
  useEffect(() => {
    ctx?.set(id, dirty)
    return () => ctx?.set(id, false)
  }, [ctx, id, dirty])
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Legacy browsers (Chrome < 119, older Safari) only prompt when returnValue is set.
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])
}

/**
 * Serialised form values for comparison (files compare by name).
 * @param form the form element
 * @returns a JSON string of [name, value] pairs
 */
function snapshot(form: HTMLFormElement): string {
  return JSON.stringify([...new FormData(form)].map(([k, v]) => [k, typeof v === "string" ? v : v.name]))
}

/**
 * Dirty tracking for an uncontrolled `<form>`: compares current values to the
 * values when the form mounted. Each new non-error `result` (the form action's
 * return value) re-baselines after React commits it, so a rejected save stays
 * dirty. A remount takes a fresh baseline.
 * The first baseline is re-taken on the next frame while the user has not
 * touched the form, because widgets such as Radix Select fill their hidden
 * native `<select>` options after mount (an early snapshot would read dirty).
 * Limitation: this is a single-frame re-take. A widget that fills its options
 * later (e.g. only after being opened) can still read dirty; filtering
 * untrusted change events was judged too invasive (programmatic changes from
 * widgets are indistinguishable from edits in jsdom tests). Such a form should
 * call `rebaseline()` once its widget signals ready.
 * Attach `ref` to the `<form>`. If the form unmounts while this host stays
 * mounted, its cleanup clears the dirty flag so the guard is released.
 * Call `rebaseline()` after changing values in code (no input/change event),
 * once React has committed them, e.g. from an effect.
 * @param result latest form-action result; undefined before the first submit
 * @returns the ref callback to attach to the form, the current dirty flag, and `rebaseline`
 */
export function useFormDirty(result?: Readonly<{ error?: string | null; success?: string | null }> | null): {
  ref: (form: HTMLFormElement | null) => void | (() => void)
  dirty: boolean
  rebaseline: () => void
} {
  const [dirty, setDirty] = useState(false)
  useUnsavedGuard(dirty)
  const rebaselineRef = useRef<() => void>(() => {})
  const rebaseline = useCallback(() => rebaselineRef.current(), [])
  useEffect(() => {
    if (result && !result.error) rebaselineRef.current()
  }, [result])
  const ref = useCallback((form: HTMLFormElement | null) => {
    if (!form) return
    let initial = snapshot(form)
    let touched = false
    setDirty(false)
    const frame = requestAnimationFrame(() => {
      if (!touched) initial = snapshot(form)
    })
    /** Compares the current values to the baseline and marks the form touched. */
    const check = () => {
      touched = true
      setDirty(snapshot(form) !== initial)
    }
    form.addEventListener("input", check)
    form.addEventListener("change", check)
    rebaselineRef.current = () => {
      touched = true
      initial = snapshot(form)
      setDirty(false)
    }
    return () => {
      cancelAnimationFrame(frame)
      form.removeEventListener("input", check)
      form.removeEventListener("change", check)
      rebaselineRef.current = () => {}
      setDirty(false)
    }
  }, [])
  return { ref, dirty, rebaseline }
}
