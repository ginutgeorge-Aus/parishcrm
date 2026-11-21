// Shared pdfkit plumbing for the letter/certificate renderers: fetch the branding
// letterhead once, open a document, collect its chunks into a Buffer.
import PDFDocument from "pdfkit"
import { getLetterheadAsset } from "@/lib/branding"

/** Uploaded letterhead image (bytes + aspect ratio), or null when none is set. */
export type LetterheadAsset = Awaited<ReturnType<typeof getLetterheadAsset>>

/**
 * Render a PDF to bytes: loads the letterhead, creates the document, runs `draw`
 * and resolves once pdfkit has flushed.
 * @param options pdfkit document options (size, layout, margin)
 * @param draw draws onto the open document, given the letterhead asset
 * @returns PDF bytes
 */
export async function renderPdfBuffer(
  options: PDFKit.PDFDocumentOptions,
  draw: (doc: PDFKit.PDFDocument, letterhead: LetterheadAsset) => void,
): Promise<Buffer> {
  const letterhead = await getLetterheadAsset()
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(options)
    const chunks: Buffer[] = []
    doc.on("data", (c: Buffer) => chunks.push(c))
    doc.on("end", () => resolve(Buffer.concat(chunks)))
    doc.on("error", reject)
    try {
      draw(doc, letterhead)
      doc.end()
    } catch (e) {
      reject(e)
    }
  })
}
