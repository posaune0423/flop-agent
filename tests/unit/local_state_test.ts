import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { IdentityEnvelope } from "../../src/identity.ts";
import { assertPrivatePathInfo, LocalStateStore } from "../../src/local_state.ts";
import { makeTestDir } from "./test_temp.ts";

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
  const parent = await makeTestDir();
  const root = `${parent}/.flop-agent`;
  const secretRoot = `${parent}/private`;
  const store = new LocalStateStore(root, secretRoot);

  await store.createIdentity(envelope);

  assertEquals(await store.readIdentity(), envelope);
  assertEquals((await Deno.stat(secretRoot)).mode! & 0o777, 0o700);
  assertEquals((await Deno.stat(`${secretRoot}/identity.json`)).mode! & 0o777, 0o400);
  assertEquals(await exists(root), false);
  assertEquals(await exists(`${root}/identity.json`), false);
  await assertRejects(() => store.createIdentity(envelope), Error, "already exists");
});

Deno.test("refuses identity initialization while a legacy identity exists", async () => {
  const parent = await makeTestDir();
  const root = `${parent}/.flop-agent`;
  await Deno.mkdir(root, { mode: 0o700 });
  await Deno.writeTextFile(`${root}/identity.json`, JSON.stringify(envelope), { mode: 0o600 });

  const error = await assertRejects(
    () => new LocalStateStore(root, `${parent}/private`).createIdentity(envelope),
    Error,
    "separately reviewed immutable migration artifact",
  );
  assertEquals(error.message.includes("agent:migrate"), false);
  assertEquals(await exists(`${parent}/private/identity.json`), false);
});

Deno.test("rejects symlinked secret storage paths", async () => {
  const parent = await makeTestDir();
  const actualRoot = `${parent}/actual`;
  await Deno.mkdir(actualRoot, { mode: 0o700 });
  const directoryInfo = await Deno.lstat(actualRoot);

  assertThrows(
    () => assertPrivatePathInfo("linked-root", { ...directoryInfo, isSymlink: true }, "directory"),
    Error,
    "symbolic link",
  );

  const outside = `${parent}/outside.json`;
  await Deno.writeTextFile(outside, JSON.stringify(envelope), { mode: 0o600 });
  const fileInfo = await Deno.lstat(outside);

  assertThrows(
    () =>
      assertPrivatePathInfo(
        "linked-identity",
        { ...fileInfo, isSymlink: true },
        "file",
        0o600,
      ),
    Error,
    "symbolic link",
  );
});

Deno.test("backs up the encrypted identity without overwriting", async () => {
  const parent = await makeTestDir();
  const store = new LocalStateStore(`${parent}/state`, `${parent}/secret`, true);
  const backup = `${parent}/flop-agent-backups/identity.json`;
  await store.createIdentity(envelope);

  await store.backupIdentity(backup);

  assertEquals(JSON.parse(await Deno.readTextFile(backup)), envelope);
  assertEquals((await Deno.stat(backup)).mode! & 0o777, 0o400);
  await assertRejects(() => store.backupIdentity(backup), Error, "already exists");
});

Deno.test("requires an absolute output directly inside the protected backup directory", async () => {
  const parent = await makeTestDir();
  const store = new LocalStateStore(`${parent}/state`, `${parent}/secret`, true);
  await store.createIdentity(envelope);

  await assertRejects(() => store.backupIdentity("relative-identity.json"), Error, "absolute");
  await assertRejects(
    () => store.backupIdentity(`${parent}/outside/identity.json`),
    Error,
    "protected backup directory",
  );
  await store.backupIdentity(`${parent}/flop-agent-backups/identity.json`);

  assertEquals((await Deno.stat(`${parent}/flop-agent-backups`)).mode! & 0o777, 0o700);
});

Deno.test("persists public task state atomically", async () => {
  const parent = await makeTestDir();
  const store = new LocalStateStore(`${parent}/state`, `${parent}/secret`, true);
  const initial = await store.readState();
  assertEquals(initial, { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} });

  initial.nonces["https://technocore.chat|did:key:test|lobby"] = "123";
  initial.cursors["mb-p-test"] = { seq: 44, head: "head-44" };
  initial.plans["technocore-onboard"] = { id: "technocore-onboard" };
  initial.receipts["technocore-onboard"] = { verified: true };
  await store.writeState(initial);

  assertEquals(await store.readState(), initial);
  assertEquals((await Deno.stat(`${parent}/state/runtime/state.json`)).mode! & 0o777, 0o600);
});

Deno.test("migrates legacy runtime files away from the identity path", async () => {
  const parent = await makeTestDir();
  const root = `${parent}/state`;
  const initial = {
    version: 1 as const,
    nonces: { lobby: "7" },
    cursors: {},
    plans: {},
    receipts: {},
  };
  await Deno.mkdir(root, { mode: 0o700 });
  await Deno.writeTextFile(`${root}/identity.json`, JSON.stringify(envelope), { mode: 0o600 });
  await Deno.writeTextFile(`${root}/state.json`, JSON.stringify(initial), { mode: 0o600 });
  await Deno.writeTextFile(`${root}/state.lock`, "", { mode: 0o600 });

  const store = new LocalStateStore(root, `${parent}/secret`, true);
  await store.migrateLegacyLayout();
  assertEquals(await store.readState(), initial);
  assertEquals(await exists(`${root}/state.json`), false);
  assertEquals(await exists(`${root}/state.lock`), false);
  assertEquals(await exists(`${root}/identity.json`), false);
  assertEquals((await Deno.stat(`${parent}/secret/identity.json`)).mode! & 0o777, 0o400);
  assertEquals(await store.readState(), initial);
  assertEquals((await Deno.stat(`${root}/runtime`)).mode! & 0o777, 0o700);
  assertEquals((await Deno.stat(`${root}/runtime/state.json`)).mode! & 0o777, 0o600);
});

Deno.test("migration requires an existing protected identity to be read-only", async () => {
  const parent = await makeTestDir();
  const root = `${parent}/state`;
  const secretRoot = `${parent}/secret`;
  await Deno.mkdir(root, { mode: 0o700 });
  await Deno.mkdir(secretRoot, { mode: 0o700 });
  await Deno.writeTextFile(`${secretRoot}/identity.json`, JSON.stringify(envelope), {
    mode: 0o600,
  });
  const store = new LocalStateStore(root, secretRoot, true);

  await assertRejects(() => store.migrateLegacyLayout(), Error, "400");
  await Deno.chmod(`${secretRoot}/identity.json`, 0o400);
  assertEquals(await store.migrateLegacyLayout(), {
    identityRoot: secretRoot,
    runtimeRoot: `${root}/runtime`,
  });
});

Deno.test("merges transactional cursor updates without clobbering a newer receipt", async () => {
  const parent = await makeTestDir();
  const store = new LocalStateStore(`${parent}/state`, `${parent}/secret`, true);
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
  const parent = await makeTestDir();
  const store = new LocalStateStore(`${parent}/state`, `${parent}/secret`, true);

  await Promise.all(Array.from({ length: 10 }, () =>
    store.updateState(async (latest) => {
      const current = latest.cursors.counter?.seq ?? 0;
      await new Promise((resolve) => setTimeout(resolve, 1));
      latest.cursors.counter = { seq: current + 1, head: `head-${current + 1}` };
    })));

  assertEquals((await store.readState()).cursors.counter.seq, 10);
});

Deno.test("holds one state lock across a multi-step task", async () => {
  const parent = await makeTestDir();
  const store = new LocalStateStore(`${parent}/state`, `${parent}/secret`, true);

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

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
