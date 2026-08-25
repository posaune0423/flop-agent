import type { AgentState } from "./local_state.ts";
import type { RoomView, TechnocoreMessage } from "./technocore.ts";

export interface InboxPort {
  readRoom(
    room: string,
    options?: { since?: number; limit?: number; wait?: number },
  ): Promise<RoomView>;
}

export async function readInboxOnce(
  client: InboxPort,
  room: string,
  state: AgentState,
  saveState: (state: AgentState) => Promise<void>,
  wait = 0,
): Promise<TechnocoreMessage[]> {
  const cursor = state.cursors[room];
  const options: { since?: number; limit: number; wait?: number } = { limit: 200 };
  if (cursor !== undefined && wait > 0) {
    options.since = cursor.seq;
    if (wait > 0) options.wait = wait;
  }
  const view = await client.readRoom(room, options);
  let messages = view.messages;
  if (cursor) {
    if (wait > 0) {
      messages = messages.filter((message) => message.seq > cursor.seq);
    } else {
      const anchor = messages.find((message) => message.seq === cursor.seq);
      if (anchor) {
        const sameHead = await messageFingerprint(anchor) === cursor.head;
        if (sameHead) messages = messages.filter((message) => message.seq > cursor.seq);
      } else if (view.last_seq > cursor.seq) {
        messages = messages.filter((message) => message.seq > cursor.seq);
      }
    }
  }
  const latest = messages.reduce<TechnocoreMessage | undefined>(
    (current, message) => !current || message.seq > current.seq ? message : current,
    undefined,
  );
  if (latest) {
    state.cursors[room] = { seq: latest.seq, head: await messageFingerprint(latest) };
    await saveState(state);
  }
  return messages;
}

export async function* followInbox(
  client: InboxPort,
  room: string,
  state: AgentState,
  saveState: (state: AgentState) => Promise<void>,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<TechnocoreMessage> {
  for (const message of await readInboxOnce(client, room, state, saveState)) {
    yield message;
    if (options.signal?.aborted) return;
  }
  while (!options.signal?.aborted) {
    await client.readRoom(room, {
      since: state.cursors[room]?.seq ?? 0,
      limit: 200,
      wait: 10,
    });
    if (options.signal?.aborted) return;
    const messages = await readInboxOnce(client, room, state, saveState);
    for (const message of messages) {
      yield message;
      if (options.signal?.aborted) return;
    }
  }
}

export async function messageFingerprint(message: TechnocoreMessage): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([
    message.seq,
    message.ts,
    message.from,
    message.nonce ?? null,
    message.text,
  ]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
