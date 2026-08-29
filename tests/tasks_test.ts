import { assert, assertEquals, assertRejects } from "@std/assert";
import type { UnlockedIdentity } from "../src/identity.ts";
import type { AgentState } from "../src/local_state.ts";
import {
  createOnboardPlan,
  type OnboardProgress,
  refreshOnboardNotes,
  runOnboardTask,
  verifyOnboardTask,
} from "../src/tasks/onboard.ts";
import type { TechnocoreMessage } from "../src/technocore.ts";

const DID = "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH";
const FP = "83c44d7b9324fb98";

async function plan() {
  return await createOnboardPlan({
    baseUrl: "https://technocore.chat",
    did: DID,
    agentName: "flop-agent",
    mailbox: "mb-p-0123456789abcdef01234567",
    repository: "https://github.com/posaune0423/flop-agent",
    commit: "a".repeat(40),
    summary: "Deno agent for signed onboarding, mailbox monitoring, and future task adapters.",
  });
}

Deno.test("plans sharded profile, contribution, mailbox, and signed lobby proof", async () => {
  const value = await plan();

  assertEquals(value.id, "technocore-onboard");
  assertEquals(value.version, 1);
  assertEquals(value.fingerprint, FP);
  assertEquals(value.profile.ns, "did-83");
  assertEquals(value.profile.key, "c44d7b9324fb98");
  assert(value.profile.value.startsWith(`${DID} `));
  assertEquals(value.contribution.ns, "contrib");
  assertEquals(value.contribution.key, FP);
  assert(value.lobbyText.includes(`contribution_sha256:${value.contribution.sha256}`));
  assert(value.lobbyText.includes("repo:https://github.com/posaune0423/flop-agent"));
  assertEquals(value.planHash.length, 64);
});

Deno.test("runs a manually-started known task to completion and persists each signed nonce", async () => {
  const value = await plan();
  const calls: string[] = [];
  const saved: AgentState[] = [];
  let seq = 10;
  const state: AgentState = { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} };
  const identity = {
    did: DID,
    destroy: () => {},
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;
  const client = {
    ensureNote(ns: string, key: string, noteValue: string) {
      calls.push(`note:${ns}/${key}`);
      return Promise.resolve({ ns, key, value: noteValue });
    },
    saySigned(_identity: UnlockedIdentity, room: string, nonce: string, text: string) {
      calls.push(`say:${room}:${nonce}`);
      return Promise.resolve(
        {
          seq: seq++,
          ts: "2026-08-26T00:00:00Z",
          from: DID,
          text,
          nonce: Number(nonce),
        } satisfies TechnocoreMessage,
      );
    },
    findMessage: () => Promise.resolve(null),
  };

  const receipt = await runOnboardTask(value, {
    client,
    identity,
    state,
    now: () => 1_000,
    saveState: (next) => {
      saved.push(structuredClone(next));
      return Promise.resolve();
    },
  });

  assertEquals(calls, [
    "note:did-83/c44d7b9324fb98",
    `note:contrib/${FP}`,
    "say:mb-p-0123456789abcdef01234567:1000",
    "say:lobby:1000",
  ]);
  assertEquals(saved.length, 5);
  assertEquals(
    (saved[0].plans["technocore-onboard"] as { progress: OnboardProgress }).progress.pending,
    { room: value.mailbox, nonce: "1000", text: value.mailboxText },
  );
  assertEquals(state.nonces[`https://technocore.chat|${DID}|lobby`], "1000");
  assertEquals(receipt.mailbox.seq, 10);
  assertEquals(receipt.lobby.seq, 11);
  assertEquals(
    (state.receipts["technocore-onboard"] as { planHash: string }).planHash,
    value.planHash,
  );
});

Deno.test("resumes without repeating already-recorded signed writes", async () => {
  const value = await plan();
  const existing: TechnocoreMessage = {
    seq: 10,
    ts: "2026-08-26T00:00:00Z",
    from: DID,
    text: value.mailboxText,
    nonce: 1000,
  };
  const progress: OnboardProgress = { mailbox: existing };
  const state: AgentState = {
    version: 1,
    nonces: { [`https://technocore.chat|${DID}|${value.mailbox}`]: "1000" },
    cursors: {},
    plans: { "technocore-onboard": { plan: value, progress } },
    receipts: {},
  };
  const rooms: string[] = [];
  const identity = {
    did: DID,
    destroy: () => {},
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;
  const client = {
    ensureNote: (ns: string, key: string, noteValue: string) =>
      Promise.resolve({ ns, key, value: noteValue }),
    saySigned(_identity: UnlockedIdentity, room: string, nonce: string, text: string) {
      rooms.push(room);
      return Promise.resolve({ seq: 11, ts: "now", from: DID, text, nonce: Number(nonce) });
    },
    findMessage: () => Promise.resolve(null),
  };

  const receipt = await runOnboardTask(value, {
    client,
    identity,
    state,
    now: () => 1_000,
    saveState: () => Promise.resolve(),
  });

  assertEquals(rooms, ["lobby"]);
  assertEquals(receipt.mailbox, existing);
});

Deno.test("refresh task only rewrites the two known notes", async () => {
  const value = await plan();
  const calls: string[] = [];
  await refreshOnboardNotes(value, {
    ensureNote(ns: string, key: string, noteValue: string) {
      calls.push(`${ns}/${key}:${noteValue.length}`);
      return Promise.resolve({ ns, key, value: noteValue });
    },
  });

  assertEquals(calls.length, 2);
  assert(calls[0].startsWith("did-83/c44d7b9324fb98:"));
  assert(calls[1].startsWith(`contrib/${FP}:`));
});

Deno.test("rejects a task plan changed after review", async () => {
  const value = await plan();
  const tampered = { ...value, lobbyText: "send something different" };
  const state: AgentState = { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} };
  const identity = {
    did: DID,
    destroy: () => {},
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;

  await assertRejects(
    () =>
      runOnboardTask(tampered, {
        client: {
          ensureNote: (ns, key, noteValue) => Promise.resolve({ ns, key, value: noteValue }),
          saySigned: () => Promise.reject(new Error("must not write")),
          findMessage: () => Promise.resolve(null),
        },
        identity,
        state,
        now: () => 1_000,
        saveState: () => Promise.resolve(),
      }),
    Error,
    "plan hash",
  );
});

Deno.test("persists a signed-write intent before sending and reconciles it after restart", async () => {
  const value = await plan();
  const initial: AgentState = { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} };
  const identity = {
    did: DID,
    destroy: () => {},
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;
  const committed: TechnocoreMessage = {
    seq: 20,
    ts: "now",
    from: DID,
    text: value.mailboxText,
    nonce: 1_000,
  };
  let persisted: AgentState | undefined;

  await assertRejects(
    () =>
      runOnboardTask(value, {
        client: {
          ensureNote: (ns, key, noteValue) => Promise.resolve({ ns, key, value: noteValue }),
          saySigned: () => Promise.reject(new Error("process exited after server commit")),
          findMessage: () => Promise.resolve(null),
        },
        identity,
        state: initial,
        now: () => 1_000,
        saveState: (next) => {
          persisted = structuredClone(next);
          return Promise.resolve();
        },
      }),
    Error,
    "process exited",
  );

  const pending = (persisted!.plans["technocore-onboard"] as {
    progress: { pending?: { room: string; nonce: string; text: string } };
  }).progress.pending;
  assertEquals(pending, { room: value.mailbox, nonce: "1000", text: value.mailboxText });

  const rooms: string[] = [];
  const receipt = await runOnboardTask(value, {
    client: {
      ensureNote: (ns, key, noteValue) => Promise.resolve({ ns, key, value: noteValue }),
      findMessage: (room, _did, nonce, text) =>
        Promise.resolve(
          room === value.mailbox && nonce === "1000" && text === value.mailboxText
            ? committed
            : null,
        ),
      saySigned: (_identity, room, nonce, text) => {
        rooms.push(room);
        return Promise.resolve({ seq: 21, ts: "now", from: DID, text, nonce: Number(nonce) });
      },
    },
    identity,
    state: persisted!,
    now: () => 1_000,
    saveState: () => Promise.resolve(),
  });

  assertEquals(receipt.mailbox, committed);
  assertEquals(rooms, ["lobby"]);
});

Deno.test("verifies both signed receipts and propagates verification transport errors", async () => {
  const value = await plan();
  const mailbox: TechnocoreMessage = {
    seq: 1,
    ts: "now",
    from: DID,
    text: value.mailboxText,
    nonce: 1,
  };
  const lobby: TechnocoreMessage = {
    seq: 2,
    ts: "now",
    from: DID,
    text: value.lobbyText,
    nonce: 1,
  };
  const receipt = {
    taskId: "technocore-onboard" as const,
    planHash: value.planHash,
    profile: value.profile,
    contribution: value.contribution,
    mailbox,
    lobby,
    verifiedAt: "now",
  };
  const verified = await verifyOnboardTask(value, receipt, {
    readNote: (_ns, key) =>
      Promise.resolve(key === value.profile.key ? value.profile.value : value.contribution.value),
    readRoom: (room) => {
      const message = room === value.mailbox ? mailbox : lobby;
      return Promise.resolve({
        room,
        count: 1,
        first_seq: message.seq,
        last_seq: message.seq,
        messages: [message],
      });
    },
  });
  assertEquals(verified, {
    profileMatches: true,
    contributionMatches: true,
    mailboxStatus: "verified",
    lobbyStatus: "verified",
  });

  await assertRejects(
    () =>
      verifyOnboardTask(value, receipt, {
        readNote: () => Promise.resolve(value.profile.value),
        readRoom: () => Promise.reject(new Error("rate limited")),
      }),
    Error,
    "rate limited",
  );

  const outOfWindow = await verifyOnboardTask(value, receipt, {
    readNote: (_ns, key) =>
      Promise.resolve(key === value.profile.key ? value.profile.value : value.contribution.value),
    readRoom: (room) =>
      Promise.resolve({
        room,
        count: 1,
        first_seq: 500,
        last_seq: 500,
        messages: [{ seq: 500, ts: "later", from: DID, text: "newer" }],
      }),
  });
  assertEquals(outOfWindow.mailboxStatus, "out_of_window");
  assertEquals(outOfWindow.lobbyStatus, "out_of_window");
});

Deno.test("does not replay a pending signed write when reconciliation cannot be trusted", async () => {
  const value = await plan();
  const state: AgentState = {
    version: 1,
    nonces: { [`${value.baseUrl}|${DID}|${value.mailbox}`]: "1000" },
    cursors: {},
    plans: {
      "technocore-onboard": {
        plan: value,
        progress: {
          pending: { room: value.mailbox, nonce: "1000", text: value.mailboxText },
        },
      },
    },
    receipts: {},
  };
  let sends = 0;
  const identity = {
    did: DID,
    destroy: () => {},
    sign: () => Promise.resolve("A".repeat(86)),
  } satisfies UnlockedIdentity;

  await assertRejects(
    () =>
      runOnboardTask(value, {
        client: {
          ensureNote: (ns, key, noteValue) => Promise.resolve({ ns, key, value: noteValue }),
          findMessage: () => Promise.reject(new Error("rate limited during reconciliation")),
          saySigned: () => {
            sends++;
            return Promise.reject(new Error("must not send"));
          },
        },
        identity,
        state,
        now: () => 1_001,
        saveState: () => Promise.resolve(),
      }),
    Error,
    "rate limited",
  );
  assertEquals(sends, 0);
});
