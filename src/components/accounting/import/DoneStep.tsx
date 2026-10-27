import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Step 4: what was imported, with a way to view it or start another file. */
export function DoneStep({
  result,
  onAgain,
}: Readonly<{ result: { imported: number; skipped: number; duplicates: number } | null; onAgain: () => void }>) {
  const tiles = [
    { label: "Imported", value: result?.imported ?? 0, className: "text-success" },
    { label: "Skipped", value: result?.skipped ?? 0, className: "" },
    { label: "Duplicates", value: result?.duplicates ?? 0, className: "" },
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h3">Import complete</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg border bg-card px-3 py-2">
              <dt className="text-xs text-muted-foreground">{t.label}</dt>
              <dd className={`text-lg font-semibold tabular ${t.className}`}>{t.value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/accounting/transactions">View transactions</Link>
          </Button>
          <Button variant="outline" onClick={onAgain}>Import another file</Button>
        </div>
      </CardContent>
    </Card>
  )
}
