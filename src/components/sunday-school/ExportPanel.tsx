import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const FIELD = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm"

/**
 * Class report download form: plain GET to the export route (no client JS).
 * Date range defaults to the class's school year.
 * @param props.classId the class
 * @param props.year the class's school year, for the default range
 */
export function ExportPanel({ classId, year }: Readonly<{ classId: number; year: number }>) {
  return (
    <Card>
      <CardHeader><CardTitle>Reports and export</CardTitle></CardHeader>
      <CardContent>
        <form method="get" action={`/api/sunday-school/${classId}/export`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 xl:items-end">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Report</span>
            <select name="report" defaultValue="summary" className={FIELD}>
              <option value="summary">Class attendance summary</option>
              <option value="history">Student attendance history</option>
              <option value="exams">Exam results</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">From</span>
            <input type="date" name="from" required defaultValue={`${year}-01-01`} className={FIELD} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">To</span>
            <input type="date" name="to" required defaultValue={`${year}-12-31`} className={FIELD} />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Format</span>
            <select name="format" defaultValue="csv" className={FIELD}>
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <Button type="submit">Download</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">Up to 2 years per export.</p>
      </CardContent>
    </Card>
  )
}
