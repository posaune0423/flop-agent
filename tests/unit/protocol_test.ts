import { assertEquals, assertThrows } from "@std/assert";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalRoomMessage,
  cleanText,
  didFromRawPublicKey,
  fingerprintDid,
  nextNonce,
  validateNonce,
} from "../../src/protocol.ts";

Deno.test("encodes the official Ed25519 public-key vector as did:key", async () => {
  const raw = base64UrlDecode("5zTqbCtiV95yNV5HKqBaTEh-a0Y8Ap7TBt8vAbVja1g");
  const did = didFromRawPublicKey(raw);

  assertEquals(did, "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH");
  assertEquals(await fingerprintDid(did), "83c44d7b9324fb98");
});

Deno.test("uses unpadded base64url", () => {
  const raw = Uint8Array.from([251, 255, 239, 1]);
  const encoded = base64UrlEncode(raw);

  assertEquals(encoded, "-__vAQ");
  assertEquals(base64UrlDecode(encoded), raw);
});

Deno.test("sweeps only the categories Technocore removes", () => {
  assertEquals(cleanText("  hello\u200b  world\n  ", 100), "hello   world");
  assertEquals(cleanText("a\u2028b\u2029c", 100), "a b c");
});

Deno.test("counts Unicode code points for protocol limits", () => {
  assertEquals(cleanText("😀😀", 2), "😀😀");
  assertThrows(() => cleanText("😀😀", 1), Error, "over the 1-character cap");
});

Deno.test("rejects empty swept text", () => {
  assertThrows(() => cleanText("\u200b\n", 100), Error, "nothing visible");
});

Deno.test("builds the exact signed-room canonical string", () => {
  assertEquals(canonicalRoomMessage("lobby", "7", " hello\nworld "), "lobby|7|hello world");
});

Deno.test("accepts only 1-19 ASCII nonce digits", () => {
  assertEquals(validateNonce("0"), "0");
  assertEquals(validateNonce("9999999999999999999"), "9999999999999999999");
  for (const value of ["", "١", "1.2", "0".repeat(20)]) {
    assertThrows(() => validateNonce(value), Error, "1-19 ASCII digits");
  }
});

Deno.test("monotonically advances a millisecond nonce", () => {
  assertEquals(nextNonce(1_000, undefined), "1000");
  assertEquals(nextNonce(1_000, "1000"), "1001");
  assertEquals(nextNonce(999, "1000"), "1001");
});

Deno.test("rejects a clock value outside the nonce range", () => {
  assertThrows(() => nextNonce(-1, undefined), Error, "clock");
});
