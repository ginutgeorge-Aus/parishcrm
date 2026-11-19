/**
 * Marker `safeDecrypt` returns for a stored value that cannot be decrypted
 * (legacy/corrupt ciphertext, wrong or rotated-away key). Lives in its own
 * dependency-free module so Client Components can recognise it; cryptoCore.ts
 * has a browser guard and cannot be imported from the client.
 */
export const DECRYPTION_ERROR_PLACEHOLDER = "[decryption error]"
