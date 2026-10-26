// src/lib/importSources.ts

export type ImportSource = "anz" | "ofx" | "qif"

export type ImportSourceConfig = {
  label: string
  description: string
  // <input accept> value
  accept: string
  // Human-readable accepted extensions, shown under the drop zone and in errors.
  acceptLabel: string
  // Short "how to export" hint shown on the Upload step.
  exportHelp: string
  // Whether the file is a PDF (binary) or a text export.
  kind: "pdf" | "text"
}

/** Upload size limit as shown to users; mirrors the 50MB cap enforced by the parse route. */
export const MAX_UPLOAD_LABEL = "50 MB"

// Order here is the display order on the Source step.
export const IMPORT_SOURCES: Record<ImportSource, ImportSourceConfig> = {
  anz: {
    label: "ANZ statement",
    description: "Statement or Transaction Report PDF",
    accept: "application/pdf,.pdf",
    acceptLabel: ".pdf",
    exportHelp: "ANZ Internet Banking → Statements → download the PDF, or Transaction Search → Export → PDF report.",
    kind: "pdf",
  },
  ofx: {
    label: "OFX / QFX",
    description: "Microsoft Money / Quicken Web Connect",
    accept: ".ofx,.qfx",
    acceptLabel: ".ofx, .qfx",
    exportHelp: "In your bank's internet banking, export transactions as OFX (\"Microsoft Money\") or QFX (\"Quicken\").",
    kind: "text",
  },
  qif: {
    label: "QIF",
    description: "Quicken Interchange Format",
    accept: ".qif",
    acceptLabel: ".qif",
    exportHelp: "In your bank's internet banking, export transactions as QIF (\"Quicken\"). QIF files don't include the account, so pick it below first.",
    kind: "text",
  },
}

/** Type guard for an untrusted source value (form field / sessionStorage). */
export function isImportSource(v: unknown): v is ImportSource {
  return v === "anz" || v === "ofx" || v === "qif"
}

/**
 * Check a picked/dropped file against an `<input accept>` list (extensions and
 * MIME types). Drag-and-drop bypasses the picker's own filter, so we re-check.
 */
export function matchesAccept(file: { name: string; type: string }, accept: string): boolean {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  return accept
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .some((t) => {
      if (t.startsWith(".")) return name.endsWith(t)
      if (t.endsWith("/*")) return type.startsWith(t.slice(0, -1))
      return type === t
    })
}
