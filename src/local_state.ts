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
  readonly runtimeRoot: string;

  constructor(
    readonly root: string = ".flop-agent",
    readonly configuredIdentityRoot?: string,
    readonly allowLegacyMigration = false,
  ) {
    this.runtimeRoot = `${root}/runtime`;
  }

  async createIdentity(envelope: IdentityEnvelope): Promise<void> {
    if (await lstatOrNull(`${this.root}/identity.json`)) {
      throw new Error(
        "legacy identity exists; use a separately reviewed immutable migration artifact before identity initialization",
      );
    }
    const identityRoot = this.identityRoot();
    await ensurePrivateDirectory(identityRoot);
    if (this.allowLegacyMigration) {
      await migrateLegacyFile(
        `${this.root}/identity.json`,
        `${identityRoot}/identity.json`,
        0o400,
        true,
      );
    }
    await writeNewJson(`${identityRoot}/identity.json`, envelope, 0o400);
  }

  async readIdentity(): Promise<IdentityEnvelope> {
    const identityRoot = this.identityRoot();
    if (this.allowLegacyMigration) {
      await ensurePrivateDirectory(identityRoot);
      await migrateLegacyFile(
        `${this.root}/identity.json`,
        `${identityRoot}/identity.json`,
        0o400,
        true,
      );
    } else {
      await requirePrivateDirectory(identityRoot);
    }
    const identityPath = `${identityRoot}/identity.json`;
    await requirePrivateFile(identityPath, 0o400);
    const value = JSON.parse(await Deno.readTextFile(identityPath));
    if (value?.version !== 1 || typeof value.did !== "string" || typeof value.crypto !== "object") {
      throw new Error("identity.json is not a supported identity envelope");
    }
    return value as IdentityEnvelope;
  }

  async backupIdentity(output: string): Promise<void> {
    if (!isAbsolute(output)) throw new Error("backup output must be an absolute path");
    const backupRoot = `${dirname(this.identityRoot())}/flop-agent-backups`;
    if (dirname(output) !== backupRoot) {
      throw new Error(`backup output must be directly inside the protected backup directory`);
    }
    const envelope = await this.readIdentity();
    await ensurePrivateDirectory(backupRoot);
    await writeNewJson(output, envelope, 0o400);
  }

  async readState(): Promise<AgentState> {
    await this.prepareRuntime();
    const statePath = `${this.runtimeRoot}/state.json`;
    try {
      await requirePrivateFile(statePath, 0o600);
      const value = JSON.parse(await Deno.readTextFile(statePath));
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
    await this.prepareRuntime();
    const target = `${this.runtimeRoot}/state.json`;
    const temporary = `${target}.tmp-${crypto.randomUUID()}`;
    try {
      await Deno.writeTextFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        createNew: true,
        mode: 0o600,
      });
      await requirePrivateFile(temporary, 0o600);
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
    await this.prepareRuntime();
    const lockPath = `${this.runtimeRoot}/state.lock`;
    const lock = await Deno.open(lockPath, {
      create: true,
      read: true,
      write: true,
      mode: 0o600,
    });
    await Deno.chmod(lockPath, 0o600);
    await requirePrivateFile(lockPath, 0o600);
    await lock.lock(true);
    try {
      const state = await this.readState();
      return await operation(state, () => this.writeState(state));
    } finally {
      await lock.unlock();
      lock.close();
    }
  }

  async migrateLegacyLayout(): Promise<{
    identityRoot: string;
    runtimeRoot: string;
  }> {
    if (!this.allowLegacyMigration) throw new Error("legacy migration is not enabled");
    await this.prepareRuntime();
    const identityRoot = this.identityRoot();
    await ensurePrivateDirectory(identityRoot);
    await migrateLegacyFile(
      `${this.root}/identity.json`,
      `${identityRoot}/identity.json`,
      0o400,
      true,
    );
    await requirePrivateFile(`${identityRoot}/identity.json`, 0o400);
    return { identityRoot, runtimeRoot: this.runtimeRoot };
  }

  private identityRoot(): string {
    if (this.configuredIdentityRoot) return this.configuredIdentityRoot;
    const homeDirectory = Deno.env.get("HOME");
    if (!homeDirectory || !isAbsolute(homeDirectory)) {
      throw new Error("HOME must be an absolute path for identity storage");
    }
    return `${homeDirectory}/Library/Application Support/flop-agent`;
  }

  private async prepareRuntime(): Promise<void> {
    if (this.allowLegacyMigration) {
      await ensurePrivateDirectory(this.root);
      const legacyStatePath = `${this.root}/state.json`;
      const legacyLockPath = `${this.root}/state.lock`;
      if (!(await lstatOrNull(legacyStatePath)) && !(await lstatOrNull(legacyLockPath))) {
        await ensurePrivateDirectory(this.runtimeRoot);
        return;
      }
      const legacyLock = await Deno.open(legacyLockPath, {
        create: true,
        read: true,
        write: true,
        mode: 0o600,
      });
      await Deno.chmod(legacyLockPath, 0o600);
      await requirePrivateFile(legacyLockPath, 0o600);
      await legacyLock.lock(true);
      try {
        await ensurePrivateDirectory(this.runtimeRoot);
        await migrateLegacyFile(
          legacyStatePath,
          `${this.runtimeRoot}/state.json`,
          0o600,
          true,
        );
        await migrateLegacyFile(
          legacyLockPath,
          `${this.runtimeRoot}/state.lock`,
          0o600,
          true,
        );
      } finally {
        await legacyLock.unlock();
        legacyLock.close();
      }
      return;
    }
    await requirePrivateDirectory(this.root);
    await requirePrivateDirectory(this.runtimeRoot);
  }
}

function emptyState(): AgentState {
  return { version: 1, nonces: {}, cursors: {}, plans: {}, receipts: {} };
}

async function ensurePrivateDirectory(path: string, tightenExisting = true): Promise<void> {
  try {
    const info = await Deno.lstat(path);
    requireOwnedPath(path, info);
    if (info.isSymlink) throw new Error(`${path} must not be a symbolic link`);
    if (!info.isDirectory) throw new Error(`${path} exists and is not a directory`);
    if (tightenExisting) await Deno.chmod(path, 0o700);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
    await Deno.mkdir(path, { recursive: true, mode: 0o700 });
    await requirePrivateDirectory(path);
  }
}

async function requirePrivateDirectory(path: string): Promise<void> {
  const info = await Deno.lstat(path);
  assertPrivatePathInfo(path, info, "directory");
}

async function requirePrivateFile(path: string, expectedMode: number): Promise<void> {
  const info = await Deno.lstat(path);
  assertPrivatePathInfo(path, info, "file", expectedMode);
}

export function assertPrivatePathInfo(
  path: string,
  info: Deno.FileInfo,
  kind: "directory" | "file",
  expectedMode?: number,
): void {
  requireOwnedPath(path, info);
  if (info.isSymlink) throw new Error(`${path} must not be a symbolic link`);
  if (kind === "directory") {
    if (!info.isDirectory) throw new Error(`${path} is not a directory`);
    if ((info.mode ?? 0) & 0o077) {
      throw new Error(`${path} permissions must not allow group/other access`);
    }
    return;
  }
  if (!info.isFile) throw new Error(`${path} is not a regular file`);
  if (info.nlink !== null && info.nlink !== 1) {
    throw new Error(`${path} must have exactly one hard link`);
  }
  if (expectedMode === undefined) throw new Error("expected file mode is required");
  if (((info.mode ?? 0) & 0o777) !== expectedMode) {
    throw new Error(`${path} permissions must be ${expectedMode.toString(8)}`);
  }
}

function requireOwnedPath(path: string, info: Deno.FileInfo): void {
  if (info.uid !== null && info.uid !== Deno.uid()) {
    throw new Error(`${path} must be owned by the current user`);
  }
}

async function migrateLegacyFile(
  source: string,
  destination: string,
  mode: number,
  allowed: boolean,
): Promise<void> {
  const sourceInfo = await lstatOrNull(source);
  const destinationInfo = await lstatOrNull(destination);
  if (!sourceInfo) return;
  if (!allowed) throw new Error(`legacy path ${source} requires an explicit migration`);
  if (destinationInfo) {
    throw new Error(`both legacy and protected paths exist for ${destination}; refusing to choose`);
  }
  requireOwnedPath(source, sourceInfo);
  if (sourceInfo.isSymlink) throw new Error(`${source} must not be a symbolic link`);
  if (!sourceInfo.isFile) throw new Error(`${source} is not a regular file`);
  if (sourceInfo.nlink !== null && sourceInfo.nlink !== 1) {
    throw new Error(`${source} must have exactly one hard link`);
  }
  if ((sourceInfo.mode ?? 0) & 0o077) {
    throw new Error(`${source} permissions must not allow group/other access`);
  }
  await Deno.rename(source, destination);
  await Deno.chmod(destination, mode);
  await requirePrivateFile(destination, mode);
}

async function lstatOrNull(path: string): Promise<Deno.FileInfo | null> {
  try {
    return await Deno.lstat(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

async function writeNewJson(path: string, value: unknown, mode: number): Promise<void> {
  try {
    await Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`, {
      createNew: true,
      mode,
    });
    await Deno.chmod(path, mode);
    await requirePrivateFile(path, mode);
  } catch (error) {
    if (error instanceof Deno.errors.AlreadyExists) throw new Error(`${path} already exists`);
    throw error;
  }
}
