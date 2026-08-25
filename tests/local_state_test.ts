import { assertEquals, assertRejects } from "@std/assert";
import type { IdentityEnvelope } from "../src/identity.ts";
import { LocalStateStore } from "../src/local_state.ts";

const envelope: IdentityEnvelope = {
  version: 1,
  did: "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH",
  crypto: {
    kdf: "PBKDF2-SHA-256",
    iterations: 1_000,
    salt: "AQEBAQEBAQEBAQEBAQEBAQ",
    cipher: "AES-256-GCM",
    iv: "AgICAgICAgICAgIC",
    ciphertext: "AwMDAw",
  },
};

Deno.test("writes identity once with private filesystem permissions", async () => {
  const parent = await Deno.makeTempDir();
  const root = `${parent}/.flop-agent`;
  const store = new LocalStateStore(root);

  await store.createIdentity(envelope);

  assertEquals(await store.readIdentity(), envelope);
  assertEquals((await Deno.stat(root)).mode! & 0o777, 0o700);
  assertEquals((await Deno.stat(`${root}/identity.json`)).mode! & 0o777, 0o600);
  await assertRejects(() => store.createIdentity(envelope), Error, "already exists");
});

Deno.test("backs up the encrypted identity without overwriting", async () => {
  const parent = await Deno.makeTempDir();
  const store = new LocalStateStore(`${parent}/state`);
  const backup = `${parent}/backup/identity.json`;
  await store.createIdentity(envelope);

  await store.backupIdentity(backup);

  assertEquals(JSON.parse(await Deno.readTextFile(backup)), envelope);
  assertEquals((await Deno.stat(backup)).mode! & 0o777, 0o600);
  await assertRejects(() => store.backupIdentity(backup), Error, "already exists");
});

Deno.test("requires an absolute backup path and preserves an existing parent mode", async () => {
  const parent = await Deno.makeTempDir();
  const store = new LocalStateStore(`${parent}/state`);
  const existing = `${parent}/existing`;
  await Deno.mkdir(existing, { mode: 0o755 });
  await store.createIdentity(envelope);

  await assertRejects(() => store.backupIdentity("relative-identity.json"), Error, "absolute");
  await store.backupIdentity(`${existing}/identity.json`);

  assertEquals((await Deno.stat(existing)).mode! & 0o777, 0o755);
});

Deno.test("persists public task state atomically", async () => {
  const parent = await Deno.makeTempDir();
  const store = new LocalStateStore(`${parent}/state`);
  const initial = await store.readState();
  assertEquals(initial, { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} });

  initial.nonces["https://technocore.chat|did:key:test|lobby"] = "123";
  initial.cursors["mb-p-test"] = { seq: 44, head: "head-44" };
  initial.plans["technocore-onboard"] = { id: "technocore-onboard" };
  initial.receipts["technocore-onboard"] = { verified: true };
  await store.writeState(initial);

  assertEquals(await store.readState(), initial);
  assertEquals((await Deno.stat(`${parent}/state/state.json`)).mode! & 0o777, 0o600);
});

Deno.test("merges transactional cursor updates without clobbering a newer receipt", async () => {
  const parent = await Deno.makeTempDir();
  const store = new LocalStateStore(`${parent}/state`);
  const stale = await store.readState();
  await store.updateState((latest) => {
    latest.receipts["technocore-onboard"] = { verified: true };
  });

  stale.cursors["mb-p-test"] = { seq: 9, head: "head-9" };
  await store.updateState((latest) => {
    latest.cursors["mb-p-test"] = stale.cursors["mb-p-test"];
  });

  const current = await store.readState();
  assertEquals(current.cursors["mb-p-test"], { seq: 9, head: "head-9" });
  assertEquals(current.receipts["technocore-onboard"], { verified: true });
});

Deno.test("serializes concurrent state transactions", async () => {
  const parent = await Deno.makeTempDir();
  const store = new LocalStateStore(`${parent}/state`);

  await Promise.all(Array.from({ length: 10 }, () =>
    store.updateState(async (latest) => {
      const current = latest.cursors.counter?.seq ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 1));
      latest.cursors.counter = { seq: current + 1, head: `head-${current + 1}` };
    })));

  assertEquals((await store.readState()).cursors.counter.seq, 10);
});

Deno.test("holds one state lock across a multi-step task", async () => {
  const parent = await Deno.makeTempDir();
  const store = new LocalStateStore(`${parent}/state`);

  const result = await store.withStateLock(async (state, save) => {
    state.nonces.lobby = "7";
    await save();
    state.receipts.task = { done: true };
    await save();
    return "complete";
  });

  assertEquals(result, "complete");
  assertEquals((await store.readState()).nonces.lobby, "7");
  assertEquals((await store.readState()).receipts.task, { done: true });
});
