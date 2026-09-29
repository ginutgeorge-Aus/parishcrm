// Shared password rule. Plain module: "use server" files may only export async functions.
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/
export const PASSWORD_MSG =
  "Password must be at least 8 characters and include uppercase, lowercase, number, and special character"
