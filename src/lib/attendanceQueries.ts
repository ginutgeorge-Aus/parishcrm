// Read-side queries for service headcount attendance (OSS-308). Callers gate
// access with canViewAttendance / canEditAttendance. Dates come back as
// "YYYY-MM-DD" strings (service date is a calendar date, stored UTC-midnight).

import { prisma } from "@/lib/prisma"
import type { HeadcountRow } from "@/lib/attendance"
import { utcDateToYmd, ymdToUtcDate } from "@/lib/venueUsage"

/** A recorded headcount with its service type name, for the edit list. */
export type RecentHeadcount = HeadcountRow & {
  id: number
  serviceTypeName: string
  notes: string | null
}

/**
 * Headcount rows with a service date in [fromYMD, toYMD] (inclusive).
 * @param fromYMD first date, YYYY-MM-DD
 * @param toYMD last date, YYYY-MM-DD
 */
export async function getHeadcountRows(fromYMD: string, toYMD: string): Promise<HeadcountRow[]> {
  const rows = await prisma.serviceHeadcount.findMany({
    where: { serviceDate: { gte: ymdToUtcDate(fromYMD), lte: ymdToUtcDate(toYMD) } },
    select: { serviceDate: true, serviceTypeId: true, adults: true, children: true },
    orderBy: { serviceDate: "asc" },
  })
  return rows.map((r) => ({
    date: utcDateToYmd(r.serviceDate),
    serviceTypeId: r.serviceTypeId,
    adults: r.adults,
    children: r.children,
  }))
}

/**
 * The most recent headcounts (newest service date first) with service type name.
 * @param limit maximum rows to return
 */
export async function getRecentHeadcounts(limit: number): Promise<RecentHeadcount[]> {
  const rows = await prisma.serviceHeadcount.findMany({
    select: {
      id: true,
      serviceDate: true,
      serviceTypeId: true,
      adults: true,
      children: true,
      notes: true,
      serviceType: { select: { name: true } },
    },
    orderBy: [{ serviceDate: "desc" }, { serviceTypeId: "asc" }],
    take: limit,
  })
  return rows.map((r) => ({
    id: r.id,
    date: utcDateToYmd(r.serviceDate),
    serviceTypeId: r.serviceTypeId,
    serviceTypeName: r.serviceType.name,
    adults: r.adults,
    children: r.children,
    notes: r.notes,
  }))
}

/** Active service types (entry form options), sorted by name. */
export async function getActiveServiceTypes(): Promise<{ id: number; name: string }[]> {
  return prisma.serviceType.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}

/** All service types including deactivated ones (trend filter keeps their history), sorted by name. */
export async function getAllServiceTypes(): Promise<{ id: number; name: string }[]> {
  return prisma.serviceType.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
}
