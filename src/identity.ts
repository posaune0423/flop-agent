export interface IdentityEnvelope {
  version: 1;
  did: string;
  crypto: {
    kdf: "PBKDF2-SHA-256";
    iterations: number;
    salt: string;
    cipher: "AES-256-GCM";
    iv: string;
    ciphertext: string;
  };
}

export interface UnlockedIdentity {
  did: string;
  sign(message: string): Promise<string>;
  destroy(): void;
}

const privateMaterial = new WeakMap<UnlockedIdentity, Uint8Array>();

export function createIdentity(): Promise<UnlockedIdentity> {
  return createIdentityInternal();
}

async function createIdentityInternal(): Promise<UnlockedIdentity> {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const rawPublicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const signingKey = await importSigningKey(pkcs8, false);
  return unlockedIdentity(signingKey, pkcs8, didFromRawPublicKey(rawPublicKey));
}

export async function identityFromPkcs8(pkcs8: Uint8Array): Promise<UnlockedIdentity> {
  const extractableKey = await importSigningKey(pkcs8, true);
  const jwk = await crypto.subtle.exportKey("jwk", extractableKey);
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x) {
    throw new Error("PKCS8 key is not an extractable Ed25519 identity");
  }
  const signingKey = await importSigningKey(pkcs8, false);
  return unlockedIdentity(signingKey, pkcs8.slice(), didFromRawPublicKey(base64UrlDecode(jwk.x)));
}

function unlockedIdentity(privateKey: CryptoKey, pkcs8: Uint8Array, did: string): UnlockedIdentity {
  let destroyed = false;
  const identity: UnlockedIdentity = {
    did,
    async sign(message: string): Promise<string> {
      if (destroyed) throw new Error("identity has been destroyed");
      const signature = await crypto.subtle.sign(
        "Ed25519",
        privateKey,
        new TextEncoder().encode(message),
      );
      return base64UrlEncode(new Uint8Array(signature));
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      privateMaterial.get(identity)?.fill(0);
      privateMaterial.delete(identity);
    },
  };
  privateMaterial.set(identity, pkcs8);
  return identity;
}

function importSigningKey(pkcs8: Uint8Array, extractable: boolean): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(pkcs8),
    { name: "Ed25519" },
    extractable,
    ["sign"],
  );
}

async function deriveEncryptionKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptIdentity(
  identity: UnlockedIdentity,
  passphrase: string,
  options: { iterations?: number; salt?: Uint8Array; iv?: Uint8Array } = {},
): Promise<IdentityEnvelope> {
  if (Array.from(passphrase).length < 12) {
    throw new Error("passphrase must be at least 12 characters");
  }
  const iterations = options.iterations ?? 600_000;
  if (!Number.isSafeInteger(iterations) || iterations < 1) {
    throw new Error("invalid KDF iterations");
  }
  const salt = options.salt?.slice() ?? crypto.getRandomValues(new Uint8Array(16));
  const iv = options.iv?.slice() ?? crypto.getRandomValues(new Uint8Array(12));
  if (salt.length !== 16) throw new Error("PBKDF2 salt must be 16 bytes");
  if (iv.length !== 12) throw new Error("AES-GCM IV must be 12 bytes");

  const key = await deriveEncryptionKey(passphrase, salt, iterations);
  const material = privateMaterial.get(identity);
  if (!material) throw new Error("identity private material is unavailable");
  const plaintext = material.slice();
  let ciphertext: ArrayBuffer;
  try {
    ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv) },
      key,
      toArrayBuffer(plaintext),
    );
  } finally {
    plaintext.fill(0);
  }
  return {
    version: 1,
    did: identity.did,
    crypto: {
      kdf: "PBKDF2-SHA-256",
      iterations,
      salt: base64UrlEncode(salt),
      cipher: "AES-256-GCM",
      iv: base64UrlEncode(iv),
      ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    },
  };
}

export async function decryptIdentity(
  envelope: IdentityEnvelope,
  passphrase: string,
): Promise<UnlockedIdentity> {
  if (
    envelope.version !== 1 || envelope.crypto.kdf !== "PBKDF2-SHA-256" ||
    envelope.crypto.cipher !== "AES-256-GCM"
  ) {
    throw new Error("unsupported identity envelope");
  }
  try {
    const salt = base64UrlDecode(envelope.crypto.salt);
    const iv = base64UrlDecode(envelope.crypto.iv);
    const ciphertext = base64UrlDecode(envelope.crypto.ciphertext);
    const key = await deriveEncryptionKey(passphrase, salt, envelope.crypto.iterations);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv) },
        key,
        toArrayBuffer(ciphertext),
      ),
    );
    try {
      const identity = await identityFromPkcs8(plaintext);
      if (identity.did !== envelope.did) {
        identity.destroy();
        throw new Error("decrypted identity does not match the public DID");
      }
      return identity;
    } finally {
      plaintext.fill(0);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("does not match")) throw error;
    throw new Error("could not decrypt identity; the passphrase or envelope is invalid", {
      cause: error,
    });
  }
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}
import { base64UrlDecode, base64UrlEncode, didFromRawPublicKey } from "./protocol.ts";
