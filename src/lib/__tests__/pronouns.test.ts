import { pronouns } from "@/lib/pronouns"
test("gender → pronoun set, inclusive default", () => {
  expect(pronouns("MALE")).toEqual({ they: "he", them: "him", their: "his" })
  expect(pronouns("FEMALE")).toEqual({ they: "she", them: "her", their: "her" })
  expect(pronouns("OTHER")).toEqual({ they: "they", them: "them", their: "their" })
  expect(pronouns(null)).toEqual({ they: "they", them: "them", their: "their" })
})
