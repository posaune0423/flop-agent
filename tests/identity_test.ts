import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  createIdentity,
  decryptIdentity,
  encryptIdentity,
  type IdentityEnvelope,
  identityFromPkcs8,
} from "../src/identity.ts";

const PKCS8_SEED_PREFIX = Uint8Array.from([
  0x30,
  0x2e,
  0x02,
  0x01,
  0x00,
  0x30,
  0x05,
  0x06,
  0x03,
  0x2b,
  0x65,
  0x70,
  0x04,
  0x22,
  0x04,
  0x20,
]);

function seededPkcs8(): Uint8Array {
  return Uint8Array.from([...PKCS8_SEED_PREFIX, ...new Uint8Array(32).fill(0xaa)]);
}

Deno.test("matches the official Ed25519 signer golden vector", async () => {
  const identity = await identityFromPkcs8(seededPkcs8());

  assertEquals(identity.did, "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH");
  assertEquals(
    await identity.sign("lobby|7|hi"),
    "iyZxdw3z10exvmun5VGhXU2saMHXM5kmcooEDbMybn66c0juk6Uqlux2YHUEeLYop2JfWMSflJPbN5XFnFtCCw",
  );
});

Deno.test("creates a fresh reusable Ed25519 identity", async () => {
  const identity = await createIdentity();

  assert(identity.did.startsWith("did:key:z6Mk"));
  assertEquals(identity.did.length, 56);
  assertEquals("pkcs8" in identity, false);
  assertEquals((await identity.sign("lobby|1|hello")).length, 86);
});

Deno.test("encrypts and decrypts the PKCS8 identity", async () => {
  const identity = await identityFromPkcs8(seededPkcs8());
  const envelope = await encryptIdentity(identity, "correct horse battery", {
    iterations: 1_000,
    salt: new Uint8Array(16).fill(1),
    iv: new Uint8Array(12).fill(2),
  });

  assertEquals(envelope.version, 1);
  assertEquals(envelope.did, identity.did);
  assertEquals(envelope.crypto.kdf, "PBKDF2-SHA-256");
  assertEquals(envelope.crypto.cipher, "AES-256-GCM");
  assert(!JSON.stringify(envelope).includes("aa".repeat(32)));

  const restored = await decryptIdentity(envelope, "correct horse battery");
  assertEquals(restored.did, identity.did);
  assertEquals(await restored.sign("lobby|7|hi"), await identity.sign("lobby|7|hi"));
});

Deno.test("rejects short passphrases and wrong passphrases", async () => {
  const identity = await identityFromPkcs8(seededPkcs8());
  await assertRejects(() => encryptIdentity(identity, "too-short"), Error, "at least 12");

  const envelope = await encryptIdentity(identity, "correct horse battery", { iterations: 1_000 });
  await assertRejects(() => decryptIdentity(envelope, "incorrect horse battery"), Error, "decrypt");
});

Deno.test("rejects an envelope whose public DID does not match the key", async () => {
  const identity = await identityFromPkcs8(seededPkcs8());
  const envelope = await encryptIdentity(identity, "correct horse battery", { iterations: 1_000 });
  const tampered: IdentityEnvelope = { ...envelope, did: envelope.did.replace(/.$/, "1") };

  await assertRejects(
    () => decryptIdentity(tampered, "correct horse battery"),
    Error,
    "does not match",
  );
});
