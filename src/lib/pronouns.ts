export type Gender = "MALE" | "FEMALE" | "OTHER"
export type PronounSet = { they: string; them: string; their: string }
// Subject/object/possessive pronouns for the birthday blessing. Anything other than
// MALE/FEMALE (OTHER, or unset) falls back to singular "they".
export function pronouns(gender: Gender | null | undefined): PronounSet {
  if (gender === "MALE") return { they: "he", them: "him", their: "his" }
  if (gender === "FEMALE") return { they: "she", them: "her", their: "her" }
  return { they: "they", them: "them", their: "their" }
}
