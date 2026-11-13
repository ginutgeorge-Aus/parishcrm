import { formatPercent, type AttendanceSummary, type ExamSummary } from "@/lib/sundaySchoolStats"

/**
 * Attendance rate + exam average side by side, with the counts behind each
 * (so "100%" from one roll reads differently from "100%" over a term).
 */
export function ProgressStats({ attendance, exams }: Readonly<{ attendance: AttendanceSummary; exams: ExamSummary }>) {
  return (
    <dl className="grid grid-cols-2 gap-2 pt-1 text-sm">
      <div>
        <dt className="text-muted-foreground">Attendance</dt>
        <dd className="text-lg font-semibold text-foreground">{formatPercent(attendance.rate)}</dd>
        <dd className="text-xs text-muted-foreground">{attendance.attended} of {attendance.marked} marked</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Exams</dt>
        <dd className="text-lg font-semibold text-foreground">{formatPercent(exams.averagePercent)}</dd>
        <dd className="text-xs text-muted-foreground">{exams.results} {exams.results === 1 ? "result" : "results"}</dd>
      </div>
    </dl>
  )
}
