"use client"

import { useState, useActionState } from "react"
import { useRouter } from "next/navigation"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FormFeedback } from "@/components/ui/FormFeedback"
import { AccountType } from "@/lib/generated/prisma/enums"
import { ActionResult } from "@/lib/actions/types"

type Account = {
  id: number
  code: string
  name: string
  type: AccountType
  description: string | null
  isActive: boolean
  groupId: number | null
}

type AccountGroup = { id: number; name: string; type: AccountType }

export function AccountForm({
  action,
  account,
  groups,
}: {
  action: (_prev: ActionResult, formData: FormData) => Promise<ActionResult>
  account?: Account
  groups: AccountGroup[]
}) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, undefined)
  const [selectedType, setSelectedType] = useState<AccountType>(
    account?.type ?? AccountType.INCOME
  )

  const filteredGroups = groups.filter((g) => g.type === selectedType)
  const initialGroupId = account?.groupId
    ? String(account.groupId)
    : filteredGroups[0] ? String(filteredGroups[0].id) : ""
  const [selectedGroupId, setSelectedGroupId] = useState(initialGroupId)

  function handleTypeChange(v: string) {
    setSelectedType(v as AccountType)
    const newGroups = groups.filter((g) => g.type === v)
    setSelectedGroupId(newGroups[0] ? String(newGroups[0].id) : "")
  }

  return (
    <form action={formAction} className="max-w-md space-y-4">
      <FormFeedback state={state} />

      <div className="space-y-1">
        <Label htmlFor="code">Code</Label>
        <Input
          id="code"
          name="code"
          defaultValue={account?.code}
          placeholder={account ? "e.g. 4001" : "Leave blank to auto-generate"}
          required={!!account}
        />
        {!account && (
          <p className="text-xs text-muted-foreground">
            Blank = next number for the type (income 4xxx, expense 5xxx)
          </p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={account?.name} required />
      </div>

      <div className="space-y-1">
        <Label htmlFor="type">Type</Label>
        <Select name="type" value={selectedType} onValueChange={handleTypeChange}>
          <SelectTrigger id="type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.values(AccountType).map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="groupId">Group</Label>
        <Select name="groupId" value={selectedGroupId} onValueChange={setSelectedGroupId} required>
          <SelectTrigger id="groupId" className="w-full">
            <SelectValue placeholder="Select a group" />
          </SelectTrigger>
          <SelectContent>
            {filteredGroups.map((g) => (
              <SelectItem key={g.id} value={String(g.id)}>{g.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="description">Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
        <Input id="description" name="description" defaultValue={account?.description ?? ""} />
      </div>

      {account && (
        <div className="space-y-1">
          <Label htmlFor="isActive">Status</Label>
          <Select name="isActive" defaultValue={String(account.isActive)}>
            <SelectTrigger id="isActive">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending}>{isPending ? "Saving…" : account ? "Save changes" : "Create category"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  )
}
