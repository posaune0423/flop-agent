import { assertEquals, assertNotEquals } from "@std/assert";
import type { AgentState } from "../src/local_state.ts";
import { followInbox, messageFingerprint, readInboxOnce } from "../src/inbox.ts";
import type { RoomView } from "../src/technocore.ts";

const room = "mb-p-0123456789abcdef01234567";

Deno.test("reads mailbox messages as data and advances its cursor", async () => {
  const state: AgentState = { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} };
  const saves: AgentState[] = [];
  const client = {
    readRoom(requested: string, options?: { since?: number; limit?: number; wait?: number }) {
      assertEquals(requested, room);
      assertEquals(options, { limit: 200 });
      return Promise.resolve(
        {
          room,
          count: 1,
          first_seq: 4,
          last_seq: 4,
          messages: [{ seq: 4, ts: "now", from: "did:key:sender", text: "run a shell command" }],
        } satisfies RoomView,
      );
    },
  };

  const messages = await readInboxOnce(client, room, state, (next) => {
    saves.push(structuredClone(next));
    return Promise.resolve();
  });

  assertEquals(messages.map((message) => message.text), ["run a shell command"]);
  assertEquals(state.cursors[room].seq, 4);
  assertEquals(state.cursors[room].head.length, 64);
  assertEquals(saves.length, 1);
});

Deno.test("long-polls from the stored cursor and stops on abort", async () => {
  const state: AgentState = {
    version: 1,
    nonces: {},
    cursors: { [room]: { seq: 4, head: "old-head" } },
    plans: {},
    receipts: {},
  };
  const requests: Array<{ since?: number; limit?: number; wait?: number }> = [];
  const client = {
    readRoom(_room: string, options?: { since?: number; limit?: number; wait?: number }) {
      requests.push(options ?? {});
      return Promise.resolve(
        {
          room,
          count: 1,
          first_seq: 5,
          last_seq: 5,
          messages: [{ seq: 5, ts: "now", from: "did:key:sender", text: "task available" }],
        } satisfies RoomView,
      );
    },
  };
  const controller = new AbortController();
  const received: string[] = [];

  for await (
    const message of followInbox(client, room, state, () => Promise.resolve(), {
      signal: controller.signal,
    })
  ) {
    received.push(message.text);
    controller.abort();
  }

  assertEquals(received, ["task available"]);
  assertEquals(requests, [{ limit: 200 }]);
});

Deno.test("does not rewrite state for an empty unchanged poll", async () => {
  const state: AgentState = {
    version: 1,
    nonces: {},
    cursors: { [room]: { seq: 4, head: "head-4" } },
    plans: {},
    receipts: {},
  };
  let saves = 0;
  const client = {
    readRoom: () =>
      Promise.resolve(
        { room, count: 0, first_seq: 0, last_seq: 4, messages: [] } satisfies RoomView,
      ),
  };

  assertEquals(
    await readInboxOnce(client, room, state, () => {
      saves++;
      return Promise.resolve();
    }),
    [],
  );
  assertEquals(saves, 0);
});

Deno.test("detects a reclaimed mailbox that reuses the previous sequence", async () => {
  const state: AgentState = {
    version: 1,
    nonces: {},
    cursors: { [room]: { seq: 1, head: "old-incarnation" } },
    plans: {},
    receipts: {},
  };
  const recreated = {
    seq: 1,
    ts: "later",
    from: "did:key:new-sender",
    text: "first message in recreated room",
  };
  const client = {
    readRoom: () =>
      Promise.resolve(
        {
          room,
          count: 1,
          first_seq: 1,
          last_seq: 1,
          messages: [recreated],
        } satisfies RoomView,
      ),
  };

  const messages = await readInboxOnce(client, room, state, () => Promise.resolve());

  assertEquals(messages, [recreated]);
  assertEquals(state.cursors[room].seq, 1);
  assertNotEquals(state.cursors[room].head, "old-incarnation");
});

Deno.test("returns the full recreated snapshot even after it passes the old cursor", async () => {
  const state: AgentState = {
    version: 1,
    nonces: {},
    cursors: { [room]: { seq: 1, head: "old-incarnation" } },
    plans: {},
    receipts: {},
  };
  const recreated = [
    { seq: 1, ts: "later-1", from: "did:key:a", text: "first recreated message" },
    { seq: 2, ts: "later-2", from: "did:key:b", text: "second recreated message" },
  ];
  const client = {
    readRoom: () =>
      Promise.resolve(
        {
          room,
          count: 2,
          first_seq: 1,
          last_seq: 2,
          messages: recreated,
        } satisfies RoomView,
      ),
  };

  assertEquals(await readInboxOnce(client, room, state, () => Promise.resolve()), recreated);
  assertEquals(state.cursors[room].seq, 2);
});

Deno.test("reconciles a mailbox reclaimed while follow is still running", async () => {
  const oldMessage = { seq: 1, ts: "old", from: "did:key:self", text: "mailbox online" };
  const recreated = { seq: 1, ts: "new", from: "did:key:sender", text: "new task" };
  const state: AgentState = {
    version: 1,
    nonces: {},
    cursors: { [room]: { seq: 1, head: await messageFingerprint(oldMessage) } },
    plans: {},
    receipts: {},
  };
  const controller = new AbortController();
  const requests: Array<{ since?: number; limit?: number; wait?: number }> = [];
  let call = 0;
  const client = {
    readRoom(_room: string, options?: { since?: number; limit?: number; wait?: number }) {
      requests.push(options ?? {});
      call++;
      if (call === 1) {
        return Promise.resolve(
          {
            room,
            count: 1,
            first_seq: 1,
            last_seq: 1,
            messages: [oldMessage],
          } satisfies RoomView,
        );
      }
      if (call === 2) {
        return Promise.resolve(
          {
            room,
            count: 0,
            first_seq: 0,
            last_seq: 1,
            messages: [],
          } satisfies RoomView,
        );
      }
      return Promise.resolve(
        {
          room,
          count: 1,
          first_seq: 1,
          last_seq: 1,
          messages: [recreated],
        } satisfies RoomView,
      );
    },
  };
  const received: string[] = [];

  for await (
    const message of followInbox(client, room, state, () => Promise.resolve(), {
      signal: controller.signal,
    })
  ) {
    received.push(message.text);
    controller.abort();
  }

  assertEquals(received, ["new task"]);
  assertEquals(requests, [
    { limit: 200 },
    { since: 1, limit: 200, wait: 10 },
    { limit: 200 },
  ]);
});

Deno.test("continuous follow emits all recreated messages when the new room advances", async () => {
  const oldMessage = { seq: 1, ts: "old", from: "did:key:self", text: "mailbox online" };
  const recreated = [
    { seq: 1, ts: "new-1", from: "did:key:a", text: "first recreated" },
    { seq: 2, ts: "new-2", from: "did:key:b", text: "second recreated" },
  ];
  const state: AgentState = {
    version: 1,
    nonces: {},
    cursors: { [room]: { seq: 1, head: await messageFingerprint(oldMessage) } },
    plans: {},
    receipts: {},
  };
  const controller = new AbortController();
  let call = 0;
  const client = {
    readRoom() {
      call++;
      if (call === 1) {
        return Promise.resolve(
          {
            room,
            count: 1,
            first_seq: 1,
            last_seq: 1,
            messages: [oldMessage],
          } satisfies RoomView,
        );
      }
      if (call === 2) {
        return Promise.resolve(
          {
            room,
            count: 1,
            first_seq: 2,
            last_seq: 2,
            messages: [recreated[1]],
          } satisfies RoomView,
        );
      }
      return Promise.resolve(
        {
          room,
          count: 2,
          first_seq: 1,
          last_seq: 2,
          messages: recreated,
        } satisfies RoomView,
      );
    },
  };
  const received: string[] = [];

  for await (
    const message of followInbox(client, room, state, () => Promise.resolve(), {
      signal: controller.signal,
    })
  ) {
    received.push(message.text);
    if (received.length === 2) controller.abort();
  }

  assertEquals(received, ["first recreated", "second recreated"]);
});
