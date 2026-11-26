import { DetailPageSkeleton } from "@/components/shared/DetailPageSkeleton"

/** Skeleton shown while the new-entry form loads. */
export default function Loading() {
  return <DetailPageSkeleton rows={6} />
}
