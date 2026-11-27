/**
 * Read the `file` field of a multipart request without letting a malformed body or a
 * text value in `file` surface as a 500 (AUD-2-16).
 *
 * @param req The incoming request.
 * @returns The uploaded file, or a 400-level error message to return to the client.
 */
export async function readUploadFile(req: Request): Promise<{ file: File } | { error: string }> {
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return { error: "Invalid request body" }
  }
  const file = formData.get("file")
  if (!(file instanceof File)) return { error: "No file provided" }
  return { file }
}
