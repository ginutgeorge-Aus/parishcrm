import "server-only"

// Build-time guard: importing this module from a Client Component fails the Next
// build, so the encryption keyring can never be bundled into client code.
// The logic lives in ./crypto-core, which Node ops scripts import directly
// (server-only throws under plain Node/tsx). Keep both entrypoints in sync.
export { encrypt, decrypt, safeDecrypt, keyIdOf, currentKeyId, assertKeyringHealthy, hmacEmail, hmacMobile } from "./cryptoCore"
