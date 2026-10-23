"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { useUnsavedGuard } from "./unsavedChanges"
import { SettingsCard } from "./ui/SettingsCard"
import { SettingsRow, settingsDescId } from "./ui/SettingsRow"
import { SettingsSubgroup } from "./ui/SettingsSubgroup"
import { finishFeatureOnboarding, saveFeatures } from "@/lib/actions/features"
import {
  FEATURES, featureDef, resolveFeatures, type FeatureDef, type FeatureKey, type FeatureOverrides,
} from "@/lib/features"

type Props = Readonly<{ initial: FeatureOverrides; welcome?: boolean }>
type State = Record<FeatureKey, boolean>

/** Full on/off map: stored override, else the registry default. */
function initialState(initial: FeatureOverrides): State {
  return Object.fromEntries(FEATURES.map((f) => [f.key, initial[f.key] ?? f.defaultOn])) as State
}

/** Label of the first parent/requirement that is off, or null when none blocks `def`. */
function blockedBy(def: FeatureDef, effective: ReadonlySet<FeatureKey>): string | null {
  const deps = [...(def.parent ? [def.parent] : []), ...(def.requires ?? [])]
  const off = deps.find((k) => !effective.has(k))
  return off ? featureDef(off).label : null
}

/**
 * Settings → Features checklist. Children sit indented under their parent and
 * are disabled while a parent/requirement is off (their own choice is kept, so
 * switching the parent back on restores them). One Save writes everything.
 */
export function FeaturesForm({ initial, welcome = false }: Props) {
  const start = useMemo(() => initialState(initial), [initial])
  const startOn = useMemo(() => resolveFeatures(start), [start])
  const [state, setState] = useState<State>(start)
  const [result, setResult] = useState<{ error?: string; success?: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const effective = useMemo(() => resolveFeatures(state), [state])
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)
  const dirty = JSON.stringify(state) !== JSON.stringify(start)
  // Locked while a request runs and after a first-run success, until navigation.
  const busy = pending || leaving
  useUnsavedGuard(dirty)

  /**
   * Run a save-like action; a transport failure shows a retry message and, on the
   * first-run prompt, a successful choice continues to the dashboard.
   */
  const run = (action: () => ReturnType<typeof saveFeatures>, fallback: string, failure: string) => {
    setResult(null)
    startTransition(async () => {
      try {
        const res = (await action()) ?? { success: fallback }
        startTransition(() => setResult(res))
        if (welcome && "success" in res) {
          setLeaving(true)
          router.push("/")
        }
      } catch {
        startTransition(() => setResult({ error: failure }))
      }
    })
  }

  /** Save the full on/off map; a transport failure shows a retry message. */
  const save = () => run(() => saveFeatures(state), "Features saved", "Could not save features. Please try again.")

  /** First-run only: end onboarding leaving every feature at its default. */
  const keepDefaults = () => run(finishFeatureOnboarding, "Default features kept", "Could not continue. Please try again.")

  /** One feature's row: label, description, blocking reason / warning, switch. */
  const row = (def: FeatureDef) => {
    const blocker = blockedBy(def, effective)
    const id = `feature-${def.key}`
    const warn = def.publicWarning && startOn.has(def.key) && !effective.has(def.key) && !blocker
    return (
      <SettingsRow
        key={def.key}
        label={<span className={blocker ? "text-muted-foreground" : undefined}>{def.label}</span>}
        htmlFor={id}
        description={
          <span className="block">
            <span className="block">{def.description}</span>
            {blocker && <span className="block">Needs {blocker}</span>}
            {warn && <span role="status" className="block text-warning">{def.publicWarning}</span>}
          </span>
        }
      >
        <Switch
          id={id}
          aria-describedby={settingsDescId(id)}
          checked={effective.has(def.key)}
          disabled={pending || blocker !== null}
          onCheckedChange={(v) => setState((s) => ({ ...s, [def.key]: v }))}
        />
      </SettingsRow>
    )
  }

  const topLevel = FEATURES.filter((f) => !f.parent)
  return (
    <div className="space-y-6">
      {welcome && (
        <p className="rounded-md border border-border bg-muted p-4 text-sm">
          Pick what your church needs. You can change this any time in Settings → Features.
        </p>
      )}
      <SettingsCard
        title="Features"
        description="Choose which parts of ParishCRM your church uses. Turning a feature off hides it and blocks it. Your data is kept, and switching it back on restores everything."
        footer={
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={save} disabled={busy} className="min-h-11 w-full sm:w-auto">
              Save
            </Button>
            {welcome && (
              <Button type="button" variant="outline" onClick={keepDefaults} disabled={busy || dirty} aria-describedby={dirty ? "keep-defaults-hint" : undefined} className="min-h-11 w-full sm:w-auto">
                Keep defaults
              </Button>
            )}
            {welcome && dirty && (
              <p id="keep-defaults-hint" className="text-sm text-muted-foreground">
                Save your changes, or undo them to keep the defaults
              </p>
            )}
          </div>
        }
      >
        {topLevel.flatMap((top) => {
          const children = FEATURES.filter((f) => f.parent === top.key)
          return [
            row(top),
            ...(children.length > 0
              ? [<SettingsSubgroup key={`${top.key}-children`} title={`${top.label} options`}>{children.map(row)}</SettingsSubgroup>]
              : []),
          ]
        })}
        <FormFeedback state={result} />
      </SettingsCard>
    </div>
  )
}
