/** @jest-environment node */

describe("encrypt / decrypt", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(32).toString("base64") // 32 zero bytes, valid 256-bit key
  })

  afterEach(() => {
    delete process.env.ENCRYPTION_KEY
    delete process.env.ENCRYPTION_KEY_V1
    delete process.env.ENCRYPTION_KEY_V2
    delete process.env.ENCRYPTION_KEY_ID
  })

  it("round-trips plaintext", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const plaintext = "Pastoral note: needs counselling. Private."
    expect(decrypt(encrypt(plaintext))).toBe(plaintext)
  })

  it("produces different ciphertext each call (random IV)", async () => {
    const { encrypt } = await import("@/lib/crypto")
    const a = encrypt("same text")
    const b = encrypt("same text")
    expect(a).not.toBe(b)
  })

  it("output starts with enc: prefix", async () => {
    const { encrypt } = await import("@/lib/crypto")
    expect(encrypt("test")).toMatch(/^enc:/)
  })

  it("decrypt returns unencrypted value as-is (migration compat)", async () => {
    const { decrypt } = await import("@/lib/crypto")
    expect(decrypt("plain old text")).toBe("plain old text")
    expect(decrypt("")).toBe("")
  })

  it("encrypt throws if ENCRYPTION_KEY not set", async () => {
    delete process.env.ENCRYPTION_KEY
    jest.resetModules()
    const { encrypt } = await import("@/lib/crypto")
    expect(() => encrypt("test")).toThrow("ENCRYPTION_KEY env var is not set")
  })

  const KEY_A = Buffer.alloc(32, 1).toString("base64") // 32 bytes of 0x01
  const KEY_B = Buffer.alloc(32, 2).toString("base64") // 32 bytes of 0x02

  it("output is versioned (enc:v1:...) using the default key id", async () => {
    const { encrypt } = await import("@/lib/crypto")
    expect(encrypt("hello")).toMatch(/^enc:v1:/)
  })

  it("decrypts a legacy 4-segment value as v1", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const versioned = encrypt("legacy secret") // enc:v1:iv:tag:ct
    const legacy = versioned.replace(/^enc:v1:/, "enc:") // strip keyId -> 4-segment
    expect(decrypt(legacy)).toBe("legacy secret")
  })

  it("encrypts with the current key id and decrypts older-key values", async () => {
    delete process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY_V1 = KEY_A
    process.env.ENCRYPTION_KEY_V2 = KEY_B
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { encrypt, decrypt } = await import("@/lib/crypto")

    const v2 = encrypt("current")
    expect(v2).toMatch(/^enc:v2:/)
    expect(decrypt(v2)).toBe("current")

    process.env.ENCRYPTION_KEY_ID = "v1"
    const { encrypt: encryptV1 } = await import("@/lib/crypto")
    const v1 = encryptV1("old")
    expect(v1).toMatch(/^enc:v1:/)
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { decrypt: decryptCurrent } = await import("@/lib/crypto")
    expect(decryptCurrent(v1)).toBe("old")
  })

  it("throws when decrypting an unknown key id", async () => {
    const { decrypt } = await import("@/lib/crypto")
    expect(() => decrypt("enc:v9:aXY=:dGFn:Y3Q=")).toThrow(/unknown key id/)
  })

  it("throws (auth failure) when the key id is present but the key is wrong", async () => {
    delete process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY_V2 = KEY_A
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const sealed = encrypt("integrity-protected") // enc:v2:... under KEY_A

    // Same key id v2, but a different key — GCM auth tag must fail to verify.
    process.env.ENCRYPTION_KEY_V2 = KEY_B
    expect(() => decrypt(sealed)).toThrow()
  })

  it("ENCRYPTION_KEY aliases to v1 when ENCRYPTION_KEY_V1 is absent", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    expect(decrypt(encrypt("aliased"))).toBe("aliased")
    expect(encrypt("x")).toMatch(/^enc:v1:/)
  })

  it("throws when the current key id has no key in the ring", async () => {
    process.env.ENCRYPTION_KEY_ID = "v3" // no ENCRYPTION_KEY_V3 set
    const { encrypt } = await import("@/lib/crypto")
    expect(() => encrypt("x")).toThrow(/current key id "v3"/)
  })

  it("keyIdOf reports the key id (v1 for legacy, null for plaintext)", async () => {
    const { encrypt, keyIdOf } = await import("@/lib/crypto")
    expect(keyIdOf(encrypt("a"))).toBe("v1")
    expect(keyIdOf("enc:aXY=:dGFn:Y3Q=")).toBe("v1") // legacy 4-segment
    expect(keyIdOf("plain")).toBeNull()
  })

  it("rejects a truncated GCM auth tag (no short-tag forgery)", async () => {
    const { encrypt, decrypt } = await import("@/lib/crypto")
    const sealed = encrypt("forgery-target") // enc:v1:iv:tag:ct
    const parts = sealed.split(":")
    const tag = Buffer.from(parts[3], "base64")
    parts[3] = tag.subarray(0, 4).toString("base64") // truncate 16-byte tag to 4
    expect(() => decrypt(parts.join(":"))).toThrow()
  })

  it("throws a clear error when a key is not 32 bytes", async () => {
    process.env.ENCRYPTION_KEY = Buffer.alloc(16).toString("base64") // truncated key
    const { encrypt } = await import("@/lib/crypto")
    expect(() => encrypt("x")).toThrow(/32 bytes.*openssl rand -base64 32/)
  })

  it("validates every key in the ring, not just the current one", async () => {
    process.env.ENCRYPTION_KEY_V2 = Buffer.alloc(8).toString("base64") // bad v2, good v1
    const { encrypt } = await import("@/lib/crypto")
    expect(() => encrypt("x")).toThrow(/32 bytes/)
  })

  it("currentKeyId reflects ENCRYPTION_KEY_ID (default v1)", async () => {
    const { currentKeyId } = await import("@/lib/crypto")
    expect(currentKeyId()).toBe("v1")
    // Rotate forward: v1 must be explicit (ENCRYPTION_KEY_V1), not the alias.
    delete process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY_V1 = KEY_A
    process.env.ENCRYPTION_KEY_V2 = KEY_B
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { currentKeyId: c2 } = await import("@/lib/crypto")
    expect(c2()).toBe("v2")
  })

  // ---: forbid the aliased-v1 retirement trap ---
  it("throws when rotated past v1 while v1 comes only from the ENCRYPTION_KEY alias", async () => {
    // beforeEach set ENCRYPTION_KEY (aliases to v1); rotate forward to v2.
    process.env.ENCRYPTION_KEY_V2 = KEY_B
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { encrypt } = await import("@/lib/crypto")
    expect(() => encrypt("x")).toThrow(/promote it to an explicit ENCRYPTION_KEY_V1/i)
  })

  it("allows rotation when v1 is supplied explicitly via ENCRYPTION_KEY_V1", async () => {
    delete process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY_V1 = KEY_A
    process.env.ENCRYPTION_KEY_V2 = KEY_B
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { encrypt, currentKeyId } = await import("@/lib/crypto")
    expect(currentKeyId()).toBe("v2")
    expect(encrypt("x")).toMatch(/^enc:v2:/)
  })

  it("still allows the ENCRYPTION_KEY alias while current id is v1", async () => {
    // Un-rotated single-key deployment (current prod state) must keep working.
    const { encrypt, currentKeyId } = await import("@/lib/crypto")
    expect(currentKeyId()).toBe("v1")
    expect(encrypt("x")).toMatch(/^enc:v1:/)
  })

  // --- safeDecrypt: tolerate one bad ciphertext in bulk exports ---
  it("safeDecrypt round-trips a valid value like decrypt", async () => {
    const { encrypt, safeDecrypt } = await import("@/lib/crypto")
    expect(safeDecrypt(encrypt("ok"))).toBe("ok")
  })

  it("safeDecrypt returns plaintext as-is", async () => {
    const { safeDecrypt } = await import("@/lib/crypto")
    expect(safeDecrypt("plain")).toBe("plain")
  })

  it("safeDecrypt returns a placeholder instead of throwing on a corrupt value", async () => {
    const { safeDecrypt } = await import("@/lib/crypto")
    // valid 5-segment shape, unknown key id -> decrypt() would throw
    expect(safeDecrypt("enc:v9:aXY=:dGFn:Y3Q=")).toBe("[decryption error]")
  })

  it("safeDecrypt returns a placeholder when the auth tag fails (wrong key)", async () => {
    delete process.env.ENCRYPTION_KEY // avoid the aliased-v1 rotation guard
    process.env.ENCRYPTION_KEY_V2 = KEY_A
    process.env.ENCRYPTION_KEY_ID = "v2"
    const { encrypt } = await import("@/lib/crypto")
    const sealed = encrypt("x") // under KEY_A
    process.env.ENCRYPTION_KEY_V2 = KEY_B // swap key -> tag verify fails
    const { safeDecrypt } = await import("@/lib/crypto")
    expect(safeDecrypt(sealed)).toBe("[decryption error]")
  })

  it("rejects a malformed key id without echoing it", async () => {
    const { decrypt } = await import("@/lib/crypto")
    const malicious = "enc:DROPTABLE:aXY=:dGFn:Y3Q="
    let msg = ""
    try {
      decrypt(malicious)
      throw new Error("expected decrypt to throw")
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).toMatch(/Decryption failed/)
    expect(msg).not.toContain("DROPTABLE")
  })

  it("rejects a non-v# key id format", async () => {
    const { decrypt } = await import("@/lib/crypto")
    let msg = ""
    try {
      decrypt("enc:v1x:aXY=:dGFn:Y3Q=")
      throw new Error("expected decrypt to throw")
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).toMatch(/invalid key id/)
    expect(msg).not.toContain("v1x")
  })

  it("rejects a well-formed but unknown key id without echoing it", async () => {
    const { decrypt } = await import("@/lib/crypto")
    let msg = ""
    try {
      decrypt("enc:v99:aXY=:dGFn:Y3Q=")
      throw new Error("expected decrypt to throw")
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e)
    }
    expect(msg).toMatch(/unknown key id/)
    expect(msg).not.toContain("v99")
  })

  // ---: harden the encrypted-value shape sniff so free-text plaintext
  // that coincidentally starts with "enc:" and has the right colon count
  // isn't routed into decrypt() and surfaced as a false "[decryption error]".
  describe("hardened encrypted-value detection", () => {
    it("keyIdOf treats a free-text note (no v<n> marker, non-base64 payload) as plaintext", async () => {
      const { keyIdOf } = await import("@/lib/crypto")
      // 5 colon-separated segments, key-id segment isn't v<n>, payload isn't
      // base64 (spaces) — exactly the shape a user-typed note could produce.
      expect(keyIdOf("enc:call the plumber:re: the leak:urgent")).toBeNull()
    })

    it("decrypt returns a free-text note (no v<n> marker, non-base64) unchanged", async () => {
      const { decrypt } = await import("@/lib/crypto")
      const note = "enc:call the plumber:re: the leak:urgent!"
      expect(decrypt(note)).toBe(note)
    })

    it("safeDecrypt does not placeholder a plaintext note shaped like ciphertext", async () => {
      const { safeDecrypt } = await import("@/lib/crypto")
      const note = "enc:reminder: pickup at 5pm, bring cash"
      expect(safeDecrypt(note)).toBe(note)
    })

    it("still detects real ciphertext (round-trips through the hardened check)", async () => {
      const { encrypt, decrypt, keyIdOf } = await import("@/lib/crypto")
      const sealed = encrypt("still works")
      expect(keyIdOf(sealed)).toBe("v1")
      expect(decrypt(sealed)).toBe("still works")
    })

    it("still detects a legacy 4-segment value with valid base64 segments", async () => {
      const { keyIdOf } = await import("@/lib/crypto")
      expect(keyIdOf("enc:aXY=:dGFn:Y3Q=")).toBe("v1")
    })

    // --- reviewer: a genuinely CORRUPTED ciphertext (versioned
    // prefix present, payload bit-flipped outside the base64 alphabet) must
    // NOT be downgraded to plaintext — the versioned marker keeps it "ours" so
    // it still reaches decrypt() and is surfaced as a bad row by the rotation
    // audit. Distinct from the free-text case above (no v<n> marker).
    it("keyIdOf still reports the key id for a corrupted versioned ciphertext (not plaintext)", async () => {
      const { keyIdOf } = await import("@/lib/crypto")
      // v<n> marker present, ciphertext segment corrupted with a non-base64 char.
      expect(keyIdOf("enc:v1:aXY=:dGFn:corrupt!payload")).toBe("v1")
    })

    it("decrypt throws (not returns-as-is) on a corrupted versioned ciphertext", async () => {
      const { decrypt } = await import("@/lib/crypto")
      expect(() => decrypt("enc:v1:aXY=:dGFn:corrupt!payload")).toThrow()
    })

    it("safeDecrypt placeholders a corrupted versioned ciphertext (a real corruption signal)", async () => {
      const { safeDecrypt } = await import("@/lib/crypto")
      expect(safeDecrypt("enc:v1:aXY=:dGFn:corrupt!payload")).toBe("[decryption error]")
    })
  })
})

describe("assertKeyringHealthy", () => {
  const strongKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64") // 32 distinct bytes
  const zeroKey = Buffer.alloc(32).toString("base64") // all-zero — weak

  afterEach(() => {
    for (const k of ["ENCRYPTION_KEY", "ENCRYPTION_KEY_V1", "ENCRYPTION_KEY_V2", "ENCRYPTION_KEY_ID", "NODE_ENV"]) {
      delete (process.env as Record<string, string | undefined>)[k]
    }
    jest.restoreAllMocks()
  })

  it("throws on a low-entropy key in production", async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
    process.env.ENCRYPTION_KEY = zeroKey
    const { assertKeyringHealthy } = await import("@/lib/crypto")
    expect(() => assertKeyringHealthy()).toThrow(/insufficient entropy/)
  })

  it("accepts a high-entropy key in production", async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "production"
    process.env.ENCRYPTION_KEY = strongKey
    const { assertKeyringHealthy } = await import("@/lib/crypto")
    expect(() => assertKeyringHealthy()).not.toThrow()
  })

  it("does NOT throw on a weak key outside production ( dev/test exemption)", async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "test"
    process.env.ENCRYPTION_KEY = zeroKey
    const { assertKeyringHealthy } = await import("@/lib/crypto")
    expect(() => assertKeyringHealthy()).not.toThrow()
  })

  it("warns about non-current keys lingering in the keyring", async () => {
    ;(process.env as Record<string, string | undefined>).NODE_ENV = "test"
    process.env.ENCRYPTION_KEY_V1 = strongKey
    process.env.ENCRYPTION_KEY_V2 = strongKey
    process.env.ENCRYPTION_KEY_ID = "v2"
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {})
    const { assertKeyringHealthy } = await import("@/lib/crypto")
    assertKeyringHealthy()
    expect(warn).toHaveBeenCalled()
    expect(warn.mock.calls.map((c) => c.join(" ")).join("\n")).toContain("v1")
  })
})

// deterministic blind index over email so the person-export can match
// registrations with an indexed WHERE instead of a full-table decrypt scan.
describe("hmacEmail ( email blind index)", () => {
  const KEY_A = Buffer.alloc(32, 1).toString("base64")
  const KEY_B = Buffer.alloc(32, 2).toString("base64")

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY_A
  })

  afterEach(() => {
    for (const k of ["ENCRYPTION_KEY", "ENCRYPTION_KEY_V1", "ENCRYPTION_KEY_V2", "ENCRYPTION_KEY_ID"]) {
      delete (process.env as Record<string, string | undefined>)[k]
    }
    jest.resetModules()
  })

  it("is deterministic for the same email", async () => {
    const { hmacEmail } = await import("@/lib/crypto")
    expect(hmacEmail("john@example.com")).toBe(hmacEmail("john@example.com"))
  })

  it("returns a 64-char lowercase hex digest (sha256)", async () => {
    const { hmacEmail } = await import("@/lib/crypto")
    expect(hmacEmail("john@example.com")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("normalises case and surrounding whitespace", async () => {
    const { hmacEmail } = await import("@/lib/crypto")
    const base = hmacEmail("john@example.com")
    expect(hmacEmail("JOHN@Example.com")).toBe(base)
    expect(hmacEmail("  john@example.com  ")).toBe(base)
  })

  it("produces different digests for different emails", async () => {
    const { hmacEmail } = await import("@/lib/crypto")
    expect(hmacEmail("a@example.com")).not.toBe(hmacEmail("b@example.com"))
  })

  it("is keyed — a different v1 key yields a different digest", async () => {
    const { hmacEmail } = await import("@/lib/crypto")
    const withA = hmacEmail("john@example.com")
    delete process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = KEY_B
    jest.resetModules()
    const { hmacEmail: hmacB } = await import("@/lib/crypto")
    expect(hmacB("john@example.com")).not.toBe(withA)
  })

  it("stays stable across key rotation (derives from v1, not the current key)", async () => {
    const { hmacEmail } = await import("@/lib/crypto")
    const beforeRotate = hmacEmail("john@example.com")
    // Rotate forward to v2 with v1 supplied explicitly (so the index key is unchanged).
    delete process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY_V1 = KEY_A
    process.env.ENCRYPTION_KEY_V2 = KEY_B
    process.env.ENCRYPTION_KEY_ID = "v2"
    jest.resetModules()
    const { hmacEmail: hmacRotated } = await import("@/lib/crypto")
    expect(hmacRotated("john@example.com")).toBe(beforeRotate)
  })
})

// mirrors hmacEmail — deterministic blind index over mobile numbers so
// MembershipApplication.mobile (encrypted) can match Person.mobile (encrypted,
// random IV) via an indexed WHERE instead of plaintext equality (which never
// matched once both sides were encrypted).
describe("hmacMobile ( mobile blind index)", () => {
  const KEY_A = Buffer.alloc(32, 1).toString("base64")
  const KEY_B = Buffer.alloc(32, 2).toString("base64")

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = KEY_A
  })

  afterEach(() => {
    for (const k of ["ENCRYPTION_KEY", "ENCRYPTION_KEY_V1", "ENCRYPTION_KEY_V2", "ENCRYPTION_KEY_ID"]) {
      delete (process.env as Record<string, string | undefined>)[k]
    }
    jest.resetModules()
  })

  it("is deterministic for the same mobile", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    expect(hmacMobile("0400111222")).toBe(hmacMobile("0400111222"))
  })

  it("returns a 64-char lowercase hex digest (sha256)", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    expect(hmacMobile("0400111222")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("normalises surrounding whitespace", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    expect(hmacMobile("  0400111222  ")).toBe(hmacMobile("0400111222"))
  })

  it("produces different digests for different mobiles", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    expect(hmacMobile("0400111222")).not.toBe(hmacMobile("0400111333"))
  })

  it("is domain-separated from hmacEmail (same v1 key, different digest)", async () => {
    const { hmacMobile, hmacEmail } = await import("@/lib/crypto")
    expect(hmacMobile("0400111222")).not.toBe(hmacEmail("0400111222"))
  })

  it("stays stable across key rotation (derives from v1, not the current key)", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    const beforeRotate = hmacMobile("0400111222")
    delete process.env.ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY_V1 = KEY_A
    process.env.ENCRYPTION_KEY_V2 = KEY_B
    process.env.ENCRYPTION_KEY_ID = "v2"
    jest.resetModules()
    const { hmacMobile: hmacRotated } = await import("@/lib/crypto")
    expect(hmacRotated("0400111222")).toBe(beforeRotate)
  })

  // hmacMobile only trimmed whitespace, so "0412345678" and
  // "+61412345678" (the same physical number) hashed to different digests —
  // silently breaking the Person<->MembershipApplication auto-match this blind
  // index exists for. Normalise before hashing so all common input shapes agree.
  it("normalises the +61/61 country-code prefix to the local 0 form", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    const local = hmacMobile("0412345678")
    expect(hmacMobile("+61412345678")).toBe(local)
    expect(hmacMobile("61412345678")).toBe(local)
  })

  it("normalises spaced and dashed formatting to the same digest", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    const base = hmacMobile("0412345678")
    expect(hmacMobile("0412 345 678")).toBe(base)
    expect(hmacMobile("0412-345-678")).toBe(base)
    expect(hmacMobile("+61 412 345 678")).toBe(base)
    expect(hmacMobile("(0412) 345-678")).toBe(base)
  })

  it("still distinguishes genuinely different numbers after normalisation", async () => {
    const { hmacMobile } = await import("@/lib/crypto")
    expect(hmacMobile("0412345678")).not.toBe(hmacMobile("0412345679"))
  })
})
