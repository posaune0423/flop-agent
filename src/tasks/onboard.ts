import type { UnlockedIdentity } from "../identity.ts";
import type { AgentState } from "../local_state.ts";
import type { RoomView, TechnocoreMessage } from "../technocore.ts";
import { cleanText, fingerprintDid, nextNonce } from "../protocol.ts";

export interface OnboardInput {
  baseUrl: string;
  did: string;
  agentName: string;
  mailbox: string;
  repository: string;
  commit: string;
  summary: string;
}

export interface PlannedNote {
  ns: string;
  key: string;
  value: string;
  sha256: string;
}

export interface OnboardPlan extends OnboardInput {
  id: "technocore-onboard";
  version: 1;
  fingerprint: string;
  profile: PlannedNote;
  contribution: PlannedNote;
  mailboxText: string;
  lobbyText: string;
  planHash: string;
}

export interface OnboardProgress {
  mailbox?: TechnocoreMessage;
  lobby?: TechnocoreMessage;
  pending?: {
    room: string;
    nonce: string;
    text: string;
  };
}

export interface OnboardReceipt {
  taskId: "technocore-onboard";
  planHash: string;
  profile: PlannedNote;
  contribution: PlannedNote;
  mailbox: TechnocoreMessage;
  lobby: TechnocoreMessage;
  verifiedAt: string;
}

export interface NotePort {
  ensureNote(
    ns: string,
    key: string,
    value: string,
  ): Promise<{ ns: string; key: string; value: string }>;
}

export interface VerificationPort {
  readNote(ns: string, key: string): Promise<string | null>;
  readRoom(
    room: string,
    options?: { since?: number; limit?: number; wait?: number },
  ): Promise<RoomView>;
}

export interface OnboardDependencies {
  client: NotePort & {
    saySigned(
      identity: UnlockedIdentity,
      room: string,
      nonce: string,
      text: string,
    ): Promise<TechnocoreMessage>;
    findMessage(
      room: string,
      did: string,
      nonce: string,
      text: string,
    ): Promise<TechnocoreMessage | null>;
  };
  identity: UnlockedIdentity;
  state: AgentState;
  now(): number;
  saveState(state: AgentState): Promise<void>;
}

export async function createOnboardPlan(input: OnboardInput): Promise<OnboardPlan> {
  const baseUrl = normalizeOrigin(input.baseUrl);
  const agentName = validName(input.agentName, "agent name");
  const mailbox = validName(input.mailbox, "mailbox");
  if (!mailbox.startsWith("mb-p-")) throw new Error("mailbox must start with mb-p-");
  const repository = validRepository(input.repository);
  const commit = input.commit.toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("commit must be a full hexadecimal hash");
  const summary = cleanText(input.summary, 320);
  const fingerprint = await fingerprintDid(input.did);
  const shard = fingerprint.slice(0, 2);
  const key = fingerprint.slice(2);
  const contributionPath = `/kv/contrib/${fingerprint}`;
  const profileValue = cleanText(
    `${input.did} agent:${agentName} mailbox:${mailbox} contribution:${contributionPath} repo:${repository}`,
    8192,
  );
  const contributionValue = cleanText(
    `technocore-contribution-v1 did:${input.did} agent:${agentName} type:tool summary:${summary} url:${repository} commit:${commit}`,
    8192,
  );
  const profile: PlannedNote = {
    ns: `did-${shard}`,
    key,
    value: profileValue,
    sha256: await sha256Hex(profileValue),
  };
  const contribution: PlannedNote = {
    ns: "contrib",
    key: fingerprint,
    value: contributionValue,
    sha256: await sha256Hex(contributionValue),
  };
  const mailboxText = cleanText(
    `mailbox-online-v1 agent:${agentName} did:${input.did} profile:/kv/${profile.ns}/${profile.key}`,
    4096,
  );
  const lobbyText = cleanText(
    `technocore-proof-v1 agent:${agentName} did:${input.did} mailbox:${mailbox} contribution:${contributionPath} contribution_sha256:${contribution.sha256} repo:${repository} commit:${commit}`,
    4096,
  );
  const withoutHash = {
    id: "technocore-onboard" as const,
    version: 1 as const,
    baseUrl,
    did: input.did,
    agentName,
    mailbox,
    repository,
    commit,
    summary,
    fingerprint,
    profile,
    contribution,
    mailboxText,
    lobbyText,
  };
  return { ...withoutHash, planHash: await hashPlanPayload(withoutHash) };
}

export async function runOnboardTask(
  plan: OnboardPlan,
  dependencies: OnboardDependencies,
): Promise<OnboardReceipt> {
  const { planHash: _recordedHash, ...payload } = plan;
  if (await hashPlanPayload(payload) !== plan.planHash) {
    throw new Error("task plan hash does not match its current contents");
  }
  if (dependencies.identity.did !== plan.did) {
    throw new Error("task plan DID does not match the unlocked identity");
  }
  const stored = dependencies.state.plans[plan.id] as
    | { plan?: OnboardPlan; progress?: OnboardProgress }
    | undefined;
  if (stored?.plan && stored.plan.planHash !== plan.planHash) {
    throw new Error("stored onboarding plan hash does not match the requested plan");
  }
  const progress: OnboardProgress = { ...stored?.progress };
  await refreshOnboardNotes(plan, dependencies.client);

  if (!progress.mailbox) {
    progress.mailbox = await runSignedStep(
      "mailbox",
      plan.mailbox,
      plan.mailboxText,
      plan,
      progress,
      dependencies,
    );
  }

  if (!progress.lobby) {
    progress.lobby = await runSignedStep(
      "lobby",
      "lobby",
      plan.lobbyText,
      plan,
      progress,
      dependencies,
    );
  }

  const receipt: OnboardReceipt = {
    taskId: "technocore-onboard",
    planHash: plan.planHash,
    profile: plan.profile,
    contribution: plan.contribution,
    mailbox: progress.mailbox,
    lobby: progress.lobby,
    verifiedAt: new Date(dependencies.now()).toISOString(),
  };
  dependencies.state.plans[plan.id] = { plan, progress };
  dependencies.state.receipts[plan.id] = receipt;
  await dependencies.saveState(dependencies.state);
  return receipt;
}

async function runSignedStep(
  step: "mailbox" | "lobby",
  room: string,
  text: string,
  plan: OnboardPlan,
  progress: OnboardProgress,
  dependencies: OnboardDependencies,
): Promise<TechnocoreMessage> {
  let pending = progress.pending;
  if (pending) {
    if (pending.room !== room || pending.text !== text) {
      throw new Error(`pending signed write belongs to another onboarding step, not ${step}`);
    }
    const reconciled = await dependencies.client.findMessage(
      room,
      plan.did,
      pending.nonce,
      text,
    );
    if (reconciled) {
      progress[step] = reconciled;
      delete progress.pending;
      await persistProgress(plan, progress, dependencies);
      return reconciled;
    }
    throw new Error(
      `pending signed write for ${room} is not in the latest room window; refusing to replay an uncertain write`,
    );
  } else {
    const nonceKey = stateNonceKey(plan, room);
    const nonce = nextNonce(dependencies.now(), dependencies.state.nonces[nonceKey]);
    pending = { room, nonce, text };
    progress.pending = pending;
    dependencies.state.nonces[nonceKey] = nonce;
    await persistProgress(plan, progress, dependencies);
  }

  const posted = await dependencies.client.saySigned(
    dependencies.identity,
    room,
    pending.nonce,
    text,
  );
  progress[step] = posted;
  delete progress.pending;
  await persistProgress(plan, progress, dependencies);
  return posted;
}

async function persistProgress(
  plan: OnboardPlan,
  progress: OnboardProgress,
  dependencies: OnboardDependencies,
): Promise<void> {
  dependencies.state.plans[plan.id] = { plan, progress };
  await dependencies.saveState(dependencies.state);
}

export async function refreshOnboardNotes(
  plan: OnboardPlan,
  client: NotePort,
): Promise<void> {
  await client.ensureNote(plan.profile.ns, plan.profile.key, plan.profile.value);
  await client.ensureNote(
    plan.contribution.ns,
    plan.contribution.key,
    plan.contribution.value,
  );
}

export async function verifyOnboardTask(
  plan: OnboardPlan,
  receipt: OnboardReceipt,
  client: VerificationPort,
): Promise<{
  profileMatches: boolean;
  contributionMatches: boolean;
  mailboxStatus: "verified" | "missing" | "out_of_window";
  lobbyStatus: "verified" | "missing" | "out_of_window";
}> {
  if (receipt.planHash !== plan.planHash) throw new Error("receipt belongs to another task plan");
  const profile = await client.readNote(plan.profile.ns, plan.profile.key);
  const contribution = await client.readNote(plan.contribution.ns, plan.contribution.key);
  const mailboxStatus = await receiptVisibility(client, plan.mailbox, plan.did, receipt.mailbox);
  const lobbyStatus = await receiptVisibility(client, "lobby", plan.did, receipt.lobby);
  return {
    profileMatches: profile === plan.profile.value,
    contributionMatches: contribution === plan.contribution.value,
    mailboxStatus,
    lobbyStatus,
  };
}

async function receiptVisibility(
  client: VerificationPort,
  room: string,
  did: string,
  message: TechnocoreMessage,
): Promise<"verified" | "missing" | "out_of_window"> {
  if (message.nonce === undefined) throw new Error(`receipt for ${room} is missing its nonce`);
  const view = await client.readRoom(room, { limit: 200 });
  const found = view.messages.some((candidate) =>
    candidate.seq === message.seq && candidate.from === did && candidate.text === message.text &&
    String(candidate.nonce) === String(message.nonce)
  );
  if (found) return "verified";
  if (view.first_seq !== null && view.first_seq > message.seq) return "out_of_window";
  return "missing";
}

function stateNonceKey(plan: OnboardPlan, room: string): string {
  return `${plan.baseUrl}|${plan.did}|${room}`;
}

function normalizeOrigin(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.pathname !== "/") {
    throw new Error("base URL must be an HTTP(S) origin");
  }
  return url.origin;
}

function validName(value: string, label: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,47}$/.test(normalized)) {
    throw new Error(`${label} must match ^[a-z0-9][a-z0-9_-]{0,47}$`);
  }
  return normalized;
}

function validRepository(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "github.com") {
    throw new Error("repository must be an https://github.com URL");
  }
  return url.toString().replace(/\/$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function hashPlanPayload(value: Omit<OnboardPlan, "planHash">): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}
