import { DetailPageSkeleton } from "@/components/shared/DetailPageSkeleton"

/** Skeleton shown while a register entry loads. */
export default function Loading() {
  return <DetailPageSkeleton rows={6} />
}
