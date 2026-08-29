import { assertEquals, assertRejects } from "@std/assert";
import * as guarded from "../src/guarded_refresh.ts";
import type { AgentState } from "../src/local_state.ts";
import { createOnboardPlan, type OnboardPlan } from "../src/tasks/onboard.ts";

Deno.test("exports one deterministic guarded refresh operation", () => {
  const exported = guarded as Record<string, unknown>;
  assertEquals(typeof exported.guardedRefresh, "function");
});

Deno.test("refreshes only the two approved notes and records a verified receipt", async () => {
  const plan = await approvedPlan();
  const state = stateWith(plan);
  const writes: string[] = [];
  let saves = 0;

  const result = await runGuarded({
    store: {
      withStateLock: (operation) =>
        operation(state, () => {
          saves++;
          return Promise.resolve();
        }),
    },
    client: {
      ensureNote: (ns, key, value) => {
        writes.push(`${ns}/${key}`);
        return Promise.resolve({ ns, key, value });
      },
      readNote: (ns, key) => {
        if (`${ns}/${key}` === `${plan.profile.ns}/${plan.profile.key}`) {
          return Promise.resolve(plan.profile.value);
        }
        if (`${ns}/${key}` === `${plan.contribution.ns}/${plan.contribution.key}`) {
          return Promise.resolve(plan.contribution.value);
        }
        return Promise.resolve(null);
      },
    },
    now: () => Date.parse("2026-08-29T06:23:18.435Z"),
  });

  assertEquals(result, {
    status: "refreshed",
    planHash: guarded.APPROVED_ONBOARDING_PLAN_HASH,
    verifiedAt: "2026-08-29T06:23:18.435Z",
  });
  assertEquals(writes, [
    `${plan.profile.ns}/${plan.profile.key}`,
    `${plan.contribution.ns}/${plan.contribution.key}`,
  ]);
  assertEquals(saves, 1);
});

Deno.test("rejects a tampered plan before any network write", async () => {
  const plan = await approvedPlan();
  plan.contribution.key = "attacker";
  const state = stateWith(plan);
  let calls = 0;

  await assertRejects(
    () =>
      runGuarded({
        store: memoryStore(state),
        client: {
          ensureNote: () => {
            calls++;
            return Promise.reject(new Error("must not write"));
          },
          readNote: () => {
            calls++;
            return Promise.resolve(null);
          },
        },
        now: () => Date.now(),
      }),
    Error,
    "approved",
  );

  assertEquals(calls, 0);
});

Deno.test("rejects another origin before any network write", async () => {
  const plan = await approvedPlan();
  plan.baseUrl = "https://example.com";
  const state = stateWith(plan);
  let calls = 0;

  await assertRejects(
    () =>
      runGuarded({
        store: memoryStore(state),
        client: {
          ensureNote: () => {
            calls++;
            return Promise.reject(new Error("must not write"));
          },
          readNote: () => {
            calls++;
            return Promise.resolve(null);
          },
        },
        now: () => Date.now(),
      }),
    Error,
    "approved",
  );

  assertEquals(calls, 0);
});

Deno.test("skips a refresh until the five-day interval has elapsed", async () => {
  const plan = await approvedPlan();
  const state = stateWith(plan);
  state.receipts["technocore-refresh-guarded"] = {
    taskId: "technocore-refresh-guarded",
    planHash: guarded.APPROVED_ONBOARDING_PLAN_HASH,
    verifiedAt: "2026-08-28T00:00:00.000Z",
  };
  let calls = 0;

  const result = await runGuarded({
    store: memoryStore(state),
    client: {
      ensureNote: () => {
        calls++;
        return Promise.reject(new Error("must not write"));
      },
      readNote: () => {
        calls++;
        return Promise.resolve(null);
      },
    },
    now: () => Date.parse("2026-08-29T00:00:00.000Z"),
  });

  assertEquals(result.status, "skipped");
  assertEquals(calls, 0);
});

interface GuardDependencies {
  store: {
    withStateLock<T>(
      operation: (state: AgentState, save: () => Promise<void>) => Promise<T>,
    ): Promise<T>;
  };
  client: {
    ensureNote(
      ns: string,
      key: string,
      value: string,
    ): Promise<{ ns: string; key: string; value: string }>;
    readNote(ns: string, key: string): Promise<string | null>;
  };
  now(): number;
}

function runGuarded(dependencies: GuardDependencies): Promise<Record<string, string>> {
  const operation = guarded.guardedRefresh as unknown as (
    dependencies: GuardDependencies,
  ) => Promise<Record<string, string>>;
  return operation(dependencies);
}

async function approvedPlan(): Promise<OnboardPlan> {
  const plan = await createOnboardPlan({
    baseUrl: "https://technocore.chat",
    did: "did:key:z6MkwfNUQw8XipdgYceYRaiQxRue5k61sxHeZdQuLYQJH1Wj",
    agentName: "flop-agent",
    mailbox: "mb-p-5d11c2d25b4102e141041d26",
    repository: "https://github.com/posaune0423/flop-agent",
    commit: "ff03767549fc31e5bcfc6992d46d27cd35e7e234",
    summary:
      "Deno agent for signed Technocore onboarding, mailbox monitoring, and future FLOP task adapters.",
  });
  assertEquals(plan.planHash, guarded.APPROVED_ONBOARDING_PLAN_HASH);
  return plan;
}

function stateWith(plan: OnboardPlan): AgentState {
  return {
    version: 1,
    nonces: {},
    cursors: {},
    plans: { "technocore-onboard": { plan, progress: {} } },
    receipts: {},
  };
}

function memoryStore(state: AgentState): GuardDependencies["store"] {
  return { withStateLock: (operation) => operation(state, () => Promise.resolve()) };
}
