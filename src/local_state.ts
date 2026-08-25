import type { IdentityEnvelope } from "./identity.ts";
import { dirname, isAbsolute } from "@std/path";

export interface AgentState {
  version: 1;
  nonces: Record<string, string>;
  cursors: Record<string, RoomCursor>;
  plans: Record<string, unknown>;
  receipts: Record<string, unknown>;
}

export interface RoomCursor {
  seq: number;
  head: string;
}

export class LocalStateStore {
  constructor(readonly root: string = ".flop-agent") {}

  async createIdentity(envelope: IdentityEnvelope): Promise<void> {
    await ensurePrivateDirectory(this.root);
    await writeNewJson(`${this.root}/identity.json`, envelope);
  }

  async readIdentity(): Promise<IdentityEnvelope> {
    const value = JSON.parse(await Deno.readTextFile(`${this.root}/identity.json`));
    if (value?.version !== 1 || typeof value.did !== "string" || typeof value.crypto !== "object") {
      throw new Error("identity.json is not a supported identity envelope");
    }
    return value as IdentityEnvelope;
  }

  async backupIdentity(output: string): Promise<void> {
    if (!isAbsolute(output)) throw new Error("backup output must be an absolute path");
    const envelope = await this.readIdentity();
    await ensurePrivateDirectory(dirname(output), false);
    await writeNewJson(output, envelope);
  }

  async readState(): Promise<AgentState> {
    try {
      const value = JSON.parse(await Deno.readTextFile(`${this.root}/state.json`));
      if (
        value?.version !== 1 || typeof value.nonces !== "object" ||
        typeof value.cursors !== "object" || typeof value.plans !== "object" ||
        typeof value.receipts !== "object"
      ) {
        throw new Error("state.json is not a supported agent state");
      }
      return value as AgentState;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return emptyState();
      throw error;
    }
  }

  async writeState(state: AgentState): Promise<void> {
    if (state.version !== 1) throw new Error("unsupported agent state version");
    await ensurePrivateDirectory(this.root);
    const target = `${this.root}/state.json`;
    const temporary = `${target}.tmp-${crypto.randomUUID()}`;
    try {
      await Deno.writeTextFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        createNew: true,
        mode: 0o600,
      });
      await Deno.rename(temporary, target);
      await Deno.chmod(target, 0o600);
    } finally {
      await Deno.remove(temporary).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  }

  async updateState(
    mutate: (state: AgentState) => void | Promise<void>,
  ): Promise<AgentState> {
    return await this.withStateLock(async (state, save) => {
      await mutate(state);
      await save();
      return state;
    });
  }

  async withStateLock<T>(
    operation: (state: AgentState, save: () => Promise<void>) => Promise<T>,
  ): Promise<T> {
    await ensurePrivateDirectory(this.root);
    const lock = await Deno.open(`${this.root}/state.lock`, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    await Deno.chmod(`${this.root}/state.lock`, 0o600);
    await lock.lock(true);
    try {
      const state = await this.readState();
      return await operation(state, () => this.writeState(state));
    } finally {
      await lock.unlock();
      lock.close();
    }
  }
}

function emptyState(): AgentState {
  return { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} };
}

async function ensurePrivateDirectory(path: string, tightenExisting = true): Promise<void> {
  let created = false;
  try {
    const stat = await Deno.stat(path);
    if (!stat.isDirectory) throw new Error(`${path} exists and is not a directory`);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    await Deno.mkdir(path, { recursive: true, mode: 0o700 });
    created = true;
  }
  if (created || tightenExisting) await Deno.chmod(path, 0o700);
}

async function writeNewJson(path: string, value: unknown): Promise<void> {
  try {
    await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, {
      createNew: true,
      mode: 0o600,
    });
    await Deno.chmod(path, 0o600);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) throw new Error(`${path} already exists`);
    throw error;
  }
}
