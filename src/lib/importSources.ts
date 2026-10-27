// src/lib/importSources.ts

export type ImportSource = "anz" | "ofx" | "qif"

export type ImportSourceConfig = {
  label: string
  description: string
  // <input accept> value
  accept: string
  // Short "how to export" hint shown on the Upload step.
  exportHelp: string
  // Whether the file is a PDF (binary) or a text export.
  kind: "pdf" | "text"
}

// Order here is the display order on the Source step.
export const IMPORT_SOURCES: Record<ImportSource, ImportSourceConfig> = {
  anz: {
    label: "ANZ statement",
    description: "Statement or Transaction Report PDF",
    accept: "application/pdf,.pdf",
    exportHelp: "ANZ Internet Banking → Statements → download the PDF, or Transaction Search → Export → PDF report.",
    kind: "pdf",
  },
  ofx: {
    label: "OFX / QFX",
    description: "Microsoft Money / Quicken Web Connect",
    accept: ".ofx,.qfx",
    exportHelp: "In your bank's internet banking, export transactions as OFX (\"Microsoft Money\") or QFX (\"Quicken\").",
    kind: "text",
  },
  qif: {
    label: "QIF",
    description: "Quicken Interchange Format",
    accept: ".qif",
    exportHelp: "In your bank's internet banking, export transactions as QIF (\"Quicken\"). QIF files don't include the account, so pick it below first.",
    kind: "text",
  },
}

/** Type guard for an untrusted source value (form field / sessionStorage). */
export function isImportSource(v: unknown): v is ImportSource {
  return v === "anz" || v === "ofx" || v === "qif"
}
