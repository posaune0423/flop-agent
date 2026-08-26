import type { UnlockedIdentity } from "./identity.ts";
import { canonicalRoomMessage, cleanText, validateNonce } from "./protocol.ts";

export type TechnocoreErrorKind =
  | "bad_request"
  | "forbidden"
  | "conflict"
  | "rate_limited"
  | "transport_unknown"
  | "contract";

export class TechnocoreError extends Error {
  constructor(
    message: string,
    readonly kind: TechnocoreErrorKind,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface TechnocoreMessage {
  seq: number;
  ts: string;
  from: string;
  text: string;
  nonce?: number;
}

export interface RoomView {
  room: string;
  count: number;
  first_seq: number | null;
  last_seq: number;
  messages: TechnocoreMessage[];
}

export class TechnocoreClient {
  readonly baseUrl: string;

  constructor(
    baseUrl: string,
    readonly fetcher: typeof fetch = fetch,
    readonly requestTimeoutMs = 15_000,
  ) {
    const parsed = new URL(baseUrl);
    if (!/^https?:$/.test(parsed.protocol) || parsed.pathname !== "/") {
      throw new Error("Technocore base URL must be an HTTP(S) origin");
    }
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error("request timeout must be positive");
    }
    this.baseUrl = parsed.origin;
  }

  async readNote(ns: string, key: string): Promise<string | null> {
    validateName(ns, "namespace");
    validateName(key, "key");
    const response = await this.fetchKnown(`${this.baseUrl}/kv/${ns}/${key}`);
    if (response.status === 404) return null;
    await requireOk(response);
    const body = await response.text();
    const separator = body.indexOf("\n\n");
    if (separator < 0) {
      throw new TechnocoreError("note response is missing its trust banner", "contract");
    }
    return body.slice(separator + 2).trimEnd();
  }

  async ensureNote(
    ns: string,
    key: string,
    value: string,
  ): Promise<{ ns: string; key: string; value: string }> {
    const cleaned = cleanText(value, 8192);
    const current = await this.readNote(ns, key);
    if (current !== null && current !== cleaned) {
      throw new TechnocoreError(
        `note ${ns}/${key} contains a different value; refusing to overwrite it`,
        "conflict",
        409,
      );
    }

    const body = current === null
      ? { value: cleaned, if_absent: true }
      : { value: cleaned, if: current };
    try {
      const response = await this.fetchKnown(
        `${this.baseUrl}/kv/${ns}/${key}?format=json`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      await requireOk(response);
    } catch (error) {
      if (
        !(error instanceof TechnocoreError) ||
        !["conflict", "transport_unknown"].includes(error.kind)
      ) {
        throw error;
      }
      const reconciled = await this.readNote(ns, key);
      if (reconciled !== cleaned) throw error;
    }

    const verified = await this.readNote(ns, key);
    if (verified !== cleaned) {
      throw new TechnocoreError(`note ${ns}/${key} readback does not match`, "contract");
    }
    return { ns, key, value: cleaned };
  }

  async readRoom(
    room: string,
    options: { since?: number; limit?: number; wait?: number } = {},
  ): Promise<RoomView> {
    validateName(room, "room");
    const query = new URLSearchParams({ format: "json" });
    if (options.since !== undefined) query.set("since", String(options.since));
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.wait !== undefined) query.set("wait", String(options.wait));
    const response = await this.fetchKnown(`${this.baseUrl}/r/${room}?${query}`);
    await requireOk(response);
    let view: RoomView;
    try {
      view = await response.json() as RoomView;
    } catch (error) {
      throw new TechnocoreError(
        "room response is not valid JSON",
        "contract",
        undefined,
        undefined,
        {
          cause: error,
        },
      );
    }
    if (!Array.isArray(view.messages) || view.room !== room) {
      throw new TechnocoreError("room response does not match the requested room", "contract");
    }
    return view;
  }

  async saySigned(
    identity: UnlockedIdentity,
    room: string,
    nonce: string,
    text: string,
  ): Promise<TechnocoreMessage> {
    validateName(room, "room");
    validateNonce(nonce);
    const swept = cleanText(text, 4096);
    const signature = await identity.sign(canonicalRoomMessage(room, nonce, swept));
    const payload = { did: identity.did, sig: signature, nonce, text: swept };

    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}/r/${room}?format=json`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      const reconciled = await this.findMessage(room, identity.did, nonce, swept);
      if (reconciled) return reconciled;
      throw new TechnocoreError(
        "signed write had an unknown transport result and could not be reconciled",
        "transport_unknown",
        undefined,
        undefined,
        { cause: error },
      );
    }
    await requireOk(response);
    let data: { posted?: TechnocoreMessage };
    try {
      data = await response.json() as { posted?: TechnocoreMessage };
    } catch (error) {
      const reconciled = await this.findMessage(room, identity.did, nonce, swept);
      if (reconciled) return reconciled;
      throw new TechnocoreError(
        "signed write response is not valid JSON",
        "contract",
        undefined,
        undefined,
        {
          cause: error,
        },
      );
    }
    if (!data.posted || !messageMatches(data.posted, identity.did, nonce, swept)) {
      const reconciled = await this.findMessage(room, identity.did, nonce, swept);
      if (reconciled) return reconciled;
      throw new TechnocoreError(
        "signed write response does not match the signed tuple",
        "contract",
      );
    }
    return data.posted;
  }

  async findMessage(
    room: string,
    did: string,
    nonce: string,
    text: string,
  ): Promise<TechnocoreMessage | null> {
    const view = await this.readRoom(room, { limit: 200 });
    return view.messages.find((message) => messageMatches(message, did, nonce, text)) ?? null;
  }

  private async fetchKnown(input: string, init?: RequestInit): Promise<Response> {
    try {
      return await this.fetcher(input, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (error) {
      throw new TechnocoreError(
        "Technocore transport result is unknown",
        "transport_unknown",
        undefined,
        undefined,
        {
          cause: error,
        },
      );
    }
  }
}

function validateName(value: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value)) {
    throw new Error(`${label} must match ^[a-z0-9][a-z0-9_-]{0,47}$`);
  }
}

function messageMatches(
  message: TechnocoreMessage,
  did: string,
  nonce: string,
  text: string,
): boolean {
  return message.from === did && String(message.nonce) === nonce && message.text === text;
}

async function requireOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.text();
  if (response.status === 429) {
    const header = response.headers.get("retry-after");
    const parsed = header === null ? Number.NaN : Number(header);
    const match = body.match(/([0-9]+(?:\.[0-9]+)?)\s*seconds?/i);
    const retryAfter = Number.isFinite(parsed) ? parsed : (match ? Number(match[1]) : undefined);
    throw new TechnocoreError(
      `Technocore rate limited the request${body ? `: ${body}` : ""}`,
      "rate_limited",
      429,
      retryAfter,
    );
  }
  const kind: TechnocoreErrorKind = response.status === 400
    ? "bad_request"
    : response.status === 403
    ? "forbidden"
    : response.status === 409
    ? "conflict"
    : "contract";
  throw new TechnocoreError(
    `Technocore returned HTTP ${response.status}${body ? `: ${body}` : ""}`,
    kind,
    response.status,
  );
}
