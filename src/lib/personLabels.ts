import type { VariantProps } from "class-variance-authority"
import { badgeVariants } from "@/components/ui/badge"
import { Classification, FamilyRole } from "@/lib/generated/prisma/enums"

type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>

/** Humanized display labels for the Person enums, mirroring users-page ROLE_LABELS. */
export const FAMILY_ROLE_LABELS: Record<FamilyRole, string> = {
  HEAD: "Head",
  SPOUSE: "Spouse",
  CHILD: "Child",
  OTHER: "Other",
}

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  MEMBER: "Member",
  VISITOR: "Visitor",
  INACTIVE: "Inactive",
  STUDENT: "Student",
}

/**
 * Badge treatment per classification. All four are visually distinct at a glance
 *: STUDENT gets a gold-tinted outline so it no longer collides with the
 * plain-gray INACTIVE secondary badge.
 */
export const CLASSIFICATION_BADGE: Record<
  Classification,
  { variant: BadgeVariant; className?: string }
> = {
  MEMBER: { variant: "default" },
  VISITOR: { variant: "outline" },
  INACTIVE: { variant: "secondary" },
  STUDENT: { variant: "outline", className: "border-primary/50 text-primary" },
}
