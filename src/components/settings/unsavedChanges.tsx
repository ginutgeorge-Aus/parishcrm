"use client"

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react"

export const DISCARD_PROMPT = "Discard unsaved changes?"

type Registry = Readonly<{ set: (id: string, dirty: boolean) => void; hasUnsaved: () => boolean }>
const UnsavedContext = createContext<Registry | null>(null)

/**
 * Holds which settings forms on the current page have unsaved edits, so the
 * tab list can confirm before navigating away.
 * @param props.children settings tabs + page
 */
export function UnsavedChangesProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const dirtyIds = useRef(new Set<string>())
  const value = useMemo<Registry>(
    () => ({
      set: (id, dirty) => {
        if (dirty) dirtyIds.current.add(id)
        else dirtyIds.current.delete(id)
      },
      hasUnsaved: () => dirtyIds.current.size > 0,
    }),
    [],
  )
  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>
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
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
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
 * values when the form mounted. A submit re-baselines (optimistic). A remount
 * (the forms' `key` changes after revalidation) takes a fresh baseline.
 * Attach `ref` to the `<form>`. If the form unmounts while this host stays
 * mounted, its cleanup clears the dirty flag so the guard is released.
 * @returns the ref callback to attach to the form, and the current dirty flag
 */
export function useFormDirty(): { ref: (form: HTMLFormElement | null) => void | (() => void); dirty: boolean } {
  const [dirty, setDirty] = useState(false)
  useUnsavedGuard(dirty)
  const ref = useCallback((form: HTMLFormElement | null) => {
    if (!form) return
    let initial = snapshot(form)
    setDirty(false)
    const check = () => setDirty(snapshot(form) !== initial)
    const saved = () => {
      initial = snapshot(form)
      setDirty(false)
    }
    form.addEventListener("input", check)
    form.addEventListener("change", check)
    form.addEventListener("submit", saved)
    return () => {
      form.removeEventListener("input", check)
      form.removeEventListener("change", check)
      form.removeEventListener("submit", saved)
      setDirty(false)
    }
  }, [])
  return { ref, dirty }
}
