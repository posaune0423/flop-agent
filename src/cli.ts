import { Command } from "@cliffy/command";
import { Secret } from "@cliffy/prompt/secret";
import { createIdentity, decryptIdentity, encryptIdentity } from "./identity.ts";
import { followInbox, readInboxOnce } from "./inbox.ts";
import { type AgentState, LocalStateStore } from "./local_state.ts";
import { fingerprintDid } from "./protocol.ts";
import { TechnocoreClient, type TechnocoreMessage } from "./libs/technocore.ts";
import {
  createOnboardPlan,
  type OnboardPlan,
  type OnboardReceipt,
  runOnboardTask,
  verifyOnboardTask,
} from "./tasks/onboard.ts";
import { knownTaskIds, taskDescription } from "./tasks/registry.ts";
import { logger } from "./utils/logger.ts";

const DEFAULT_BASE_URL = "https://technocore.chat";
const DEFAULT_REPOSITORY = "https://github.com/posaune0423/flop-agent";
const DEFAULT_SUMMARY =
  "Deno agent for signed Technocore onboarding, mailbox monitoring, and future FLOP task adapters.";

export function buildCli() {
  const identity = new Command()
    .description("Create, inspect, and back up the local encrypted identity.")
    .command(
      "init",
      new Command().description("Create the Ed25519 identity once.").action(identityInit),
    )
    .command(
      "show",
      new Command().description("Print the public DID without decrypting the key.").action(
        identityShow,
      ),
    )
    .command(
      "backup",
      new Command()
        .description("Copy the encrypted identity to a new path.")
        .option("-o, --output <path:string>", "Absolute backup path.", { required: true })
        .action(async ({ output }) => {
          await new LocalStateStore().backupIdentity(output);
          logger.info(`Encrypted identity backed up to ${output}`);
        }),
    );

  const task = new Command()
    .description("Plan, run, and verify statically reviewed task adapters.")
    .command("list", new Command().description("List known task adapters.").action(taskList))
    .command(
      "plan",
      new Command()
        .description("Create a reviewable plan without network writes.")
        .arguments("<id:string>")
        .option("--agent-name <name:string>", "Public Technocore agent name.", {
          default: "flop-agent",
        })
        .option("--repository <url:string>", "Public contribution repository.", {
          default: DEFAULT_REPOSITORY,
        })
        .option("--commit <sha:string>", "Full commit hash for the contribution.")
        .option("--summary <text:string>", "Public contribution summary.", {
          default: DEFAULT_SUMMARY,
        })
        .option("--mailbox <room:string>", "Reuse a specific mb-p- mailbox name.")
        .action(taskPlan),
    )
    .command(
      "run",
      new Command()
        .description("Manually start a known task; it then runs without intermediate prompts.")
        .arguments("<id:string>")
        .action((_options, id) => taskRun(id)),
    )
    .command(
      "status",
      new Command()
        .description("Compare a task receipt with live Technocore state.")
        .arguments("<id:string>")
        .action((_options, id) => taskStatus(id)),
    );

  const inbox = new Command()
    .description("Read the configured mailbox as untrusted data.")
    .command(
      "read",
      new Command().description("Read available mailbox messages once.").action(inboxRead),
    )
    .command(
      "follow",
      new Command().description("Long-poll the mailbox until interrupted.").action(inboxFollow),
    );

  const security = new Command()
    .description("Apply deterministic local storage security migrations.")
    .command(
      "migrate",
      new Command()
        .description("Move legacy identity and runtime files into separated protected roots.")
        .action(securityMigrate),
    );

  return new Command()
    .name("flop-agent")
    .version("0.1.0")
    .description("Minimal Deno FLOP task agent for Technocore.")
    .command("identity", identity)
    .command("task", task)
    .command("inbox", inbox)
    .command("security", security);
}

async function identityInit(): Promise<void> {
  const store = new LocalStateStore();
  const passphrase = await Secret.prompt({
    message: "New identity passphrase:",
    minLength: 12,
  });
  const confirmation = await Secret.prompt({
    message: "Confirm passphrase:",
    minLength: 12,
  });
  if (passphrase !== confirmation) throw new Error("passphrases do not match");
  const identity = await createIdentity();
  try {
    await store.createIdentity(await encryptIdentity(identity, passphrase));
  } finally {
    identity.destroy();
  }
  logger.info(`Created ${identity.did}`);
  logger.info(
    "The encrypted key is in the protected application-support directory; back it up before publishing.",
  );
}

async function identityShow(): Promise<void> {
  const did = (await new LocalStateStore().readIdentity()).did;
  printJson({ did, fingerprint: await fingerprintDid(did) });
}

async function securityMigrate(): Promise<void> {
  const result = await new LocalStateStore(".flop-agent", undefined, true).migrateLegacyLayout();
  printJson({ migrated: true, ...result });
}

function taskList(): void {
  for (const id of knownTaskIds()) console.log(`${id}\t${taskDescription(id)}`);
}

async function taskPlan(
  options: {
    agentName: string;
    repository: string;
    commit?: string;
    summary: string;
    mailbox?: string;
  },
  id: string,
): Promise<void> {
  if (id !== "technocore-onboard") throw unknownTask(id);
  if (!options.commit) throw new Error("--commit is required for technocore-onboard");

  printJson(await planOnboardTask(new LocalStateStore(), options as OnboardPlanOptions));
}

export interface OnboardPlanOptions {
  agentName: string;
  repository: string;
  commit: string;
  summary: string;
  mailbox?: string;
}

export async function planOnboardTask(
  store: LocalStateStore,
  options: OnboardPlanOptions,
): Promise<OnboardPlan> {
  const taskId = "technocore-onboard";
  const envelope = await store.readIdentity();
  let plan: OnboardPlan | undefined;
  await store.updateState(async (state) => {
    const existing = state.plans[taskId] as
      | { plan?: OnboardPlan; progress?: unknown }
      | undefined;
    plan = await createOnboardPlan({
      baseUrl: DEFAULT_BASE_URL,
      did: envelope.did,
      agentName: options.agentName,
      mailbox: options.mailbox ?? existing?.plan?.mailbox ?? randomMailbox(),
      repository: options.repository,
      commit: options.commit!,
      summary: options.summary,
    });
    if (existing?.plan && existing.plan.planHash !== plan.planHash) {
      throw new Error(
        "a different onboarding plan already exists; preserve or remove it deliberately",
      );
    }
    state.plans[taskId] = { plan, progress: existing?.progress ?? {} };
  });
  return plan!;
}

async function taskRun(id: string): Promise<void> {
  const store = new LocalStateStore();
  if (!knownTaskIds().includes(id as never)) throw unknownTask(id);
  const unlocked = await decryptIdentity(
    await store.readIdentity(),
    await Secret.prompt("Identity passphrase:"),
  );
  try {
    const result = await store.withStateLock(async (state, save) => {
      const plan = onboardRecordFromState(state);
      const client = new TechnocoreClient(plan.baseUrl);
      return await runOnboardTask(plan, {
        client,
        identity: unlocked,
        state,
        now: Date.now,
        saveState: () => save(),
      });
    });
    printJson(result);
  } finally {
    unlocked.destroy();
  }
}

async function taskStatus(id: string): Promise<void> {
  if (!knownTaskIds().includes(id as never)) throw unknownTask(id);
  const { plan, state } = await loadOnboardRecord();
  const client = new TechnocoreClient(plan.baseUrl);
  const receipt = state.receipts[id] as OnboardReceipt | undefined;
  if (!receipt) throw new Error("no local onboarding receipt; run the task first");
  printJson({
    taskId: id,
    did: plan.did,
    ...(await verifyOnboardTask(plan, receipt, client)),
    mailbox: plan.mailbox,
    localReceipt: receipt,
  });
}

async function inboxRead(): Promise<void> {
  const store = new LocalStateStore();
  const { plan, state } = await loadOnboardRecord(store);
  const client = new TechnocoreClient(plan.baseUrl);
  const messages = await readInboxOnce(
    client,
    plan.mailbox,
    state,
    (next) => mergeCursor(store, plan.mailbox, next),
  );
  for (const message of messages) printUntrusted(message);
}

async function inboxFollow(): Promise<void> {
  const store = new LocalStateStore();
  const { plan, state } = await loadOnboardRecord(store);
  const client = new TechnocoreClient(plan.baseUrl);
  const controller = new AbortController();
  const stop = () => controller.abort();
  Deno.addSignalListener("SIGINT", stop);
  try {
    for await (
      const message of followInbox(
        client,
        plan.mailbox,
        state,
        (next) => mergeCursor(store, plan.mailbox, next),
        { signal: controller.signal },
      )
    ) {
      printUntrusted(message);
    }
  } finally {
    Deno.removeSignalListener("SIGINT", stop);
  }
}

async function loadOnboardRecord(store = new LocalStateStore()): Promise<{
  plan: OnboardPlan;
  state: AgentState;
}> {
  const state = await store.readState();
  return { plan: onboardRecordFromState(state), state };
}

function onboardRecordFromState(state: AgentState): OnboardPlan {
  const record = state.plans["technocore-onboard"] as { plan?: OnboardPlan } | undefined;
  if (!record?.plan || record.plan.id !== "technocore-onboard" || !record.plan.planHash) {
    throw new Error("run `task plan technocore-onboard --commit <full-sha>` first");
  }
  return record.plan;
}

function randomMailbox(): string {
  return `mb-p-${
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
      byte.toString(16).padStart(2, "0")).join("")
  }`;
}

function unknownTask(id: string): Error {
  return new Error(`unknown task ${id}; choose one of: ${knownTaskIds().join(", ")}`);
}

async function mergeCursor(
  store: LocalStateStore,
  room: string,
  candidate: AgentState,
): Promise<void> {
  const cursor = candidate.cursors[room];
  if (!cursor) return;
  await store.updateState((latest) => {
    latest.cursors[room] = cursor;
  });
}

function printUntrusted(message: TechnocoreMessage): void {
  printJson({ untrusted: true, ...message });
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

if (import.meta.main) {
  try {
    await buildCli().parse(Deno.args);
  } catch (error) {
    logger.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exitCode = 1;
  }
}
