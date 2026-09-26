import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function toFloat(d: { toString(): string } | number): number {
  return typeof d === "number" ? d : Number.parseFloat(d.toString())
}
