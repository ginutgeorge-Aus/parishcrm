"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { FormFeedback } from "@/components/ui/FormFeedback"
import {
  addGroupMember, removeGroupMember, searchGroupCandidates, updateGroupMember, type GroupCandidate,
} from "@/lib/actions/group"
import { GROUP_ROLES, GROUP_ROLE_LABELS, MAX_MEMBER_TITLE, MIN_PERSON_SEARCH, type MemberRow } from "@/lib/groups"

type Props = Readonly<{
  groupId: number
  members: MemberRow[]
  readOnly?: boolean
  /** Link member names to /people/[id] (staff only; organisers can't open people pages). */
  linkPeople?: boolean
}>

/**
 * Group members: name search to add, role/title edit and remove per row.
 * Rows stack on phones (one card per member) and line up as a grid from `sm`.
 * Shared by the staff group page and the organiser's My groups page.
 */
export function MembersPanel({ groupId, members, readOnly = false, linkPeople = false }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /** Run a membership action, surfacing any error; `onOk` runs on success. */
  function run(fn: () => Promise<{ error: string } | undefined>, onOk?: () => void) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fn()
        if (res && "error" in res) setError(res.error)
        else onOk?.()
      } catch {
        setError("Something went wrong. Please try again.")
      }
    })
  }

  return (
    <div className="space-y-4">
      {!readOnly && <AddMember groupId={groupId} disabled={pending} run={run} />}
      <FormFeedback state={{ error }} />
      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Members">
          {members.map((m) => (
            <MemberItem key={m.personId} groupId={groupId} member={m} readOnly={readOnly} linkPeople={linkPeople} disabled={pending} run={run} />
          ))}
        </ul>
      )}
    </div>
  )
}

type Run = (fn: () => Promise<{ error: string } | undefined>, onOk?: () => void) => void

/** Person search box + results; each result has an Add button. */
function AddMember({ groupId, disabled, run }: Readonly<{ groupId: number; disabled: boolean; run: Run }>) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<GroupCandidate[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [searching, startSearch] = useTransition()

  /** Look up people matching the query (names only). */
  function search(e: React.FormEvent) {
    e.preventDefault()
    setSearchError(null)
    startSearch(async () => {
      try {
        const res = await searchGroupCandidates(groupId, query)
        if ("error" in res) setSearchError(res.error)
        else setResults(res.people)
      } catch {
        setSearchError("Search failed. Please try again.")
      }
    })
  }

  return (
    <div className="space-y-2">
      <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row" role="search">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people by name…"
          aria-label="Search people to add"
          maxLength={100}
          className="min-h-11 sm:min-h-0 sm:w-72"
        />
        <Button type="submit" variant="outline" className="min-h-11 sm:min-h-0" disabled={searching || query.trim().length < MIN_PERSON_SEARCH}>
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>
      <FormFeedback state={{ error: searchError }} />
      {results !== null && (
        results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matching people who aren&apos;t already members.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border" aria-label="Search results">
            {results.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  {p.name} <span className="text-muted-foreground">({p.familyName})</span>
                </span>
                <Button
                  size="sm"
                  className="min-h-11 sm:min-h-0"
                  disabled={disabled}
                  onClick={() => run(() => addGroupMember(groupId, p.id), () => setResults((r) => r?.filter((x) => x.id !== p.id) ?? null))}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  )
}

/** One member: name, role select, title input, Save (when changed) and Remove. */
function MemberItem({ groupId, member: m, readOnly, linkPeople, disabled, run }: Readonly<{
  groupId: number; member: MemberRow; readOnly: boolean; linkPeople: boolean; disabled: boolean; run: Run
}>) {
  const [role, setRole] = useState(m.role)
  const [title, setTitle] = useState(m.title)
  const dirty = role !== m.role || title.trim() !== m.title
  const name = linkPeople ? <Link href={`/people/${m.personId}`} className="hover:underline">{m.name}</Link> : m.name

  if (readOnly) {
    return (
      <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
        <span className="font-medium text-foreground">{name}</span>
        <span className="text-muted-foreground">{m.familyName}</span>
        {m.role === "LEADER" && <Badge variant="secondary">Leader</Badge>}
        {m.title && <span className="text-muted-foreground">{m.title}</span>}
      </li>
    )
  }

  return (
    <li className="grid grid-cols-1 gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,12rem)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{m.familyName}</p>
      </div>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value as MemberRow["role"])}
        aria-label={`Role for ${m.name}`}
        className="h-11 rounded-md border border-input bg-background px-2 text-sm sm:h-9"
      >
        {GROUP_ROLES.map((r) => <option key={r} value={r}>{GROUP_ROLE_LABELS[r]}</option>)}
      </select>
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        aria-label={`Title for ${m.name}`}
        maxLength={MAX_MEMBER_TITLE}
        className="min-h-11 sm:min-h-0"
      />
      <div className="flex gap-2">
        <Button size="sm" className="min-h-11 flex-1 sm:min-h-0 sm:flex-none" disabled={disabled || !dirty}
          onClick={() => run(() => updateGroupMember(groupId, m.personId, role, title))}>
          Save
        </Button>
        <Button size="sm" variant="ghost" className="min-h-11 flex-1 text-destructive hover:text-destructive sm:min-h-0 sm:flex-none" disabled={disabled}
          onClick={() => run(() => removeGroupMember(groupId, m.personId))}>
          Remove
        </Button>
      </div>
    </li>
  )
}
