import { assertEquals, assertRejects } from "@std/assert";
import type { UnlockedIdentity } from "../src/identity.ts";
import { TechnocoreClient, TechnocoreError, type TechnocoreMessage } from "../src/technocore.ts";

const DID = "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH";

function response(body: string, status = 200, headers?: HeadersInit): Response {
  return new Response(body, { status, headers });
}

Deno.test("creates an absent note with CAS and verifies the readback", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const replies = [
    response("missing", 404),
    response(JSON.stringify({ ns: "did-83", key: "c44d7b9324fb98" })),
    response(`!! UNTRUSTED CONTENT\n\n${DID}`),
  ];
  const client = new TechnocoreClient("https://technocore.chat", (input, init) => {
    calls.push({ url: String(input), init });
    return Promise.resolve(replies.shift()!);
  });

  const result = await client.ensureNote("did-83", "c44d7b9324fb98", DID);

  assertEquals(result, { ns: "did-83", key: "c44d7b9324fb98", value: DID });
  assertEquals(calls[1].url, "https://technocore.chat/kv/did-83/c44d7b9324fb98?format=json");
  assertEquals(calls[1].init?.method, "POST");
  assertEquals(JSON.parse(String(calls[1].init?.body)), { value: DID, if_absent: true });
});

Deno.test("refreshes an identical note but refuses a different value", async () => {
  const refreshCalls: RequestInit[] = [];
  const refreshReplies = [
    response(`banner\n\n${DID}`),
    response("{}"),
    response(`banner\n\n${DID}`),
  ];
  const refresh = new TechnocoreClient("https://technocore.chat", (_input, init) => {
    if (init) refreshCalls.push(init);
    return Promise.resolve(refreshReplies.shift()!);
  });

  await refresh.ensureNote("did-83", "key", DID);
  const refreshWrite = refreshCalls.find((init) => init.method === "POST")!;
  assertEquals(JSON.parse(String(refreshWrite.body)), { value: DID, if: DID });

  const conflict = new TechnocoreClient(
    "https://technocore.chat",
    () => Promise.resolve(response("banner\n\nsomeone-else")),
  );
  await assertRejects(
    () => conflict.ensureNote("did-83", "key", DID),
    TechnocoreError,
    "different value",
  );
});

Deno.test("signs the canonical payload and verifies the posted tuple", async () => {
  let signed = "";
  let body: Record<string, unknown> = {};
  const identity = {
    did: DID,
    pkcs8: new Uint8Array(),
    sign(message: string) {
      signed = message;
      return Promise.resolve("A".repeat(86));
    },
  } satisfies UnlockedIdentity;
  const client = new TechnocoreClient("https://technocore.chat", (_input, init) => {
    body = JSON.parse(String(init?.body));
    return Promise.resolve(response(JSON.stringify({
      posted: { seq: 91, ts: "2026-08-26T00:00:00Z", from: DID, text: "hello world", nonce: 7 },
    })));
  });

  const posted = await client.saySigned(identity, "lobby", "7", "hello\nworld");

  assertEquals(signed, "lobby|7|hello world");
  assertEquals(body, { did: DID, sig: "A".repeat(86), nonce: "7", text: "hello world" });
  assertEquals(posted.seq, 91);
});

Deno.test("surfaces rate limits without unbounded retry", async () => {
  const client = new TechnocoreClient(
    "https://technocore.chat",
    () => Promise.resolve(response("retry in 3.5 seconds", 429, { "Retry-After": "3.5" })),
  );

  const error = await assertRejects(
    () => client.readRoom("lobby", { limit: 1 }),
    TechnocoreError,
    "rate limited",
  );
  assertEquals(error.kind, "rate_limited");
  assertEquals(error.retryAfterSeconds, 3.5);
});

Deno.test("reconciles a signed write after an unknown transport result", async () => {
  const posted: TechnocoreMessage = {
    seq: 92,
    ts: "2026-08-26T00:00:00Z",
    from: DID,
    text: "hello",
    nonce: 8,
  };
  let calls = 0;
  const client = new TechnocoreClient("https://technocore.chat", () => {
    calls++;
    if (calls === 1) return Promise.reject(new TypeError("connection reset"));
    return Promise.resolve(response(JSON.stringify({
      room: "lobby",
      count: 1,
      first_seq: 92,
      last_seq: 92,
      messages: [posted],
    })));
  });
  const identity = {
    did: DID,
    pkcs8: new Uint8Array(),
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;

  assertEquals(await client.saySigned(identity, "lobby", "8", "hello"), posted);
  assertEquals(calls, 2);
});

Deno.test("fails closed when the server response does not match the signed tuple", async () => {
  const identity = {
    did: DID,
    pkcs8: new Uint8Array(),
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;
  const client = new TechnocoreClient(
    "https://technocore.chat",
    () =>
      Promise.resolve(response(JSON.stringify({
        posted: { seq: 1, ts: "now", from: DID, text: "tampered", nonce: 9 },
      }))),
  );

  await assertRejects(
    () => client.saySigned(identity, "lobby", "9", "hello"),
    TechnocoreError,
    "does not match",
  );
});

Deno.test("reconciles a committed write after a malformed success response", async () => {
  const committed: TechnocoreMessage = {
    seq: 93,
    ts: "now",
    from: DID,
    text: "hello",
    nonce: 10,
  };
  let calls = 0;
  const client = new TechnocoreClient("https://technocore.chat", () => {
    calls++;
    return Promise.resolve(
      calls === 1 ? response("not-json") : response(JSON.stringify({
        room: "lobby",
        count: 1,
        first_seq: 93,
        last_seq: 93,
        messages: [committed],
      })),
    );
  });
  const identity = {
    did: DID,
    pkcs8: new Uint8Array(),
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;

  assertEquals(await client.saySigned(identity, "lobby", "10", "hello"), committed);
  assertEquals(calls, 2);
});

Deno.test("attaches a bounded timeout signal to every request", async () => {
  let hasSignal = false;
  const client = new TechnocoreClient(
    "https://technocore.chat",
    (_input, init) => {
      hasSignal = init?.signal instanceof AbortSignal;
      return Promise.reject(new Error("stop after inspecting request"));
    },
    5,
  );

  await assertRejects(() => client.readRoom("lobby"), TechnocoreError, "unknown");
  assertEquals(hasSignal, true);
});

Deno.test("reconciles a committed signed write when its response times out", async () => {
  const committed: TechnocoreMessage = {
    seq: 94,
    ts: "now",
    from: DID,
    text: "timeout check",
    nonce: 11,
  };
  let calls = 0;
  const client = new TechnocoreClient(
    "https://technocore.chat",
    (_input, init) => {
      calls++;
      if (calls === 1) {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal!;
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return Promise.resolve(response(JSON.stringify({
        room: "lobby",
        count: 1,
        first_seq: 94,
        last_seq: 94,
        messages: [committed],
      })));
    },
    5,
  );
  const identity = {
    did: DID,
    pkcs8: new Uint8Array(),
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;

  assertEquals(
    await client.saySigned(identity, "lobby", "11", "timeout check"),
    committed,
  );
  assertEquals(calls, 2);
});
