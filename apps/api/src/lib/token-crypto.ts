import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM encryption for Strava OAuth tokens at rest, so a database dump,
// backup or leaked connection string doesn't hand out live Strava access.
// Stored form: "enc:v1:<iv>:<auth tag>:<ciphertext>", each part base64.
//
// TOKEN_ENCRYPTION_KEY is 32 random bytes, hex (64 chars) or base64 encoded —
// `openssl rand -hex 32`. Without it (local dev only) tokens are stored as
// plaintext. Values written before encryption was enabled have no prefix and
// are read as plaintext, then re-encrypted on the next save or at startup
// (encryptLegacyTokens in token.service.ts).

const PREFIX = "enc:v1:";

function loadKey(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, hex or base64 encoded (`openssl rand -hex 32`)");
  }
  return key;
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  if (!key) return plaintext;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString("base64")).join(":");
}

export function decryptToken(stored: string): string {
  if (!isEncrypted(stored)) return stored;

  const key = loadKey();
  if (!key) throw new Error("Stored Strava token is encrypted but TOKEN_ENCRYPTION_KEY is not set");

  const [iv, tag, ciphertext] = stored.slice(PREFIX.length).split(":").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
