import { z } from "zod"

/** Sunday School parent email limits (OSS-14). Client-safe: the compose form reads them. */
export const MAX_SS_MESSAGE_SUBJECT = 200
export const MAX_SS_MESSAGE_BODY = 10000
/** Most children one send may select (a class is far smaller; bounds the id list). */
export const MAX_SS_MESSAGE_STUDENTS = 500
/** One send per class per window, so a double-click or a retry storm cannot spam parents. */
export const SS_MESSAGE_WINDOW_MS = 5 * 60 * 1000

/** Compose form: plain-text single-line subject and body, length-bounded, plus the selected children. */
export const SsMessageSchema = z.object({
  subject: z.string().trim().min(1, "Subject is required")
    .max(MAX_SS_MESSAGE_SUBJECT, `Subject must be ${MAX_SS_MESSAGE_SUBJECT} characters or fewer`)
    .refine((v) => !/[\r\n]/.test(v), "Subject must be a single line"),
  // Browsers submit line breaks as CRLF; normalise first so the limit matches the textarea's maxLength count.
  body: z.string().transform((v) => v.replace(/\r\n?/g, "\n")).pipe(
    z.string().trim().min(1, "Message is required").max(MAX_SS_MESSAGE_BODY, `Message must be ${MAX_SS_MESSAGE_BODY} characters or fewer`),
  ),
  studentIds: z.array(z.string().regex(/^\d{1,10}$/, "Invalid child").transform(Number)
    .refine((n) => n > 0 && n <= 2147483647, "Invalid child"))
    .min(1, "Select at least one child")
    .max(MAX_SS_MESSAGE_STUDENTS, "Too many children selected")
    .transform((ids) => [...new Set(ids)]),
})
