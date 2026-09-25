function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}
// 29 Feb observed on 28 Feb in a non-leap year — else new Date(year,1,29) rolls to 1 Mar.
export function calendarDateInYear(year: number, month: number, day: number): Date {
  const observedDay = month === 1 && day === 29 && !isLeapYear(year) ? 28 : day
  return new Date(year, month, observedDay)
}
