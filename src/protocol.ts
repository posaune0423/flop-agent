const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]/gu;
const NONCE = /^[0-9]{1,19}$/;

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlDecode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("invalid base64url");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export function base58BtcEncode(value: Uint8Array): string {
  let integer = 0n;
  for (const byte of value) integer = integer * 256n + BigInt(byte);

  let encoded = "";
  while (integer > 0n) {
    encoded = BASE58[Number(integer % 58n)] + encoded;
    integer /= 58n;
  }
  for (const byte of value) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded || "1";
}

export function didFromRawPublicKey(rawPublicKey: Uint8Array): string {
  if (rawPublicKey.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  const bytes = new Uint8Array(ED25519_MULTICODEC.length + rawPublicKey.length);
  bytes.set(ED25519_MULTICODEC);
  bytes.set(rawPublicKey, ED25519_MULTICODEC.length);
  return `did:key:z${base58BtcEncode(bytes)}`;
}

export async function fingerprintDid(did: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(did));
  return Array.from(
    new Uint8Array(digest).slice(0, 8),
    (byte) => byte.toString(16).padStart(2, "0"),
  )
    .join("");
}

export function cleanText(value: string, limit: number): string {
  const cleaned = value.replace(INVISIBLE, " ").trim();
  if (!cleaned) throw new Error("nothing visible remains after the single-line sweep");
  const length = Array.from(cleaned).length;
  if (length > limit) {
    throw new Error(`${length} characters after sweep, over the ${limit}-character cap`);
  }
  return cleaned;
}

export function validateNonce(value: string): string {
  if (!NONCE.test(value)) throw new Error("nonce must contain 1-19 ASCII digits");
  return value;
}

export function nextNonce(nowMs: number, last?: string): string {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("clock must be a non-negative integer");
  }
  const now = BigInt(nowMs);
  const next = last === undefined
    ? now
    : (now > BigInt(validateNonce(last)) ? now : BigInt(last) + 1n);
  return validateNonce(next.toString());
}

export function canonicalRoomMessage(room: string, nonce: string, text: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(room)) throw new Error("invalid room name");
  return `${room}|${validateNonce(nonce)}|${cleanText(text, 4096)}`;
}
