import {
  APPROVED_NOTES,
  APPROVED_ONBOARDING_PLAN_HASH,
  APPROVED_ORIGIN,
  GUARDED_RECEIPT_ID,
  GUARDED_RUNTIME_ROOT,
  MIN_REFRESH_INTERVAL_MS,
} from "./constants/guarded_refresh.ts";
import { type AgentState, LocalStateStore } from "./local_state.ts";
import type { OnboardPlan } from "./tasks/onboard.ts";
import { TechnocoreClient } from "./libs/technocore.ts";

export { APPROVED_ONBOARDING_PLAN_HASH } from "./constants/guarded_refresh.ts";

export interface GuardedRefreshStore {
  withStateLock<T>(
    operation: (state: AgentState, save: () => Promise<void>) => Promise<T>,
  ): Promise<T>;
}

export interface GuardedRefreshClient {
  ensureNote(
    ns: string,
    key: string,
    value: string,
  ): Promise<{ ns: string; key: string; value: string }>;
  readNote(ns: string, key: string): Promise<string | null>;
}

export interface GuardedRefreshDependencies {
  store: GuardedRefreshStore;
  client: GuardedRefreshClient;
  now(): number;
}

export type GuardedRefreshResult =
  | { status: "refreshed"; planHash: string; verifiedAt: string }
  | { status: "skipped"; planHash: string; verifiedAt: string };

export function guardedRefresh(
  dependencies: GuardedRefreshDependencies,
): Promise<GuardedRefreshResult> {
  return dependencies.store.withStateLock(async (state, save) => {
    const plan = approvedPlanFromState(state);
    await validateApprovedPlan(plan);

    const now = dependencies.now();
    if (!Number.isFinite(now) || now < 0) throw new Error("current time is invalid");
    const previous = state.receipts[GUARDED_RECEIPT_ID] as
      | { planHash?: unknown; verifiedAt?: unknown }
      | undefined;
    if (previous) {
      if (
        previous.planHash !== APPROVED_ONBOARDING_PLAN_HASH ||
        typeof previous.verifiedAt !== "string"
      ) {
        throw new Error("guarded refresh receipt is invalid");
      }
      const previousTime = Date.parse(previous.verifiedAt);
      if (!Number.isFinite(previousTime)) {
        throw new Error("guarded refresh receipt time is invalid");
      }
      if (now - previousTime < 0) throw new Error("clock moved behind the guarded refresh receipt");
      if (now - previousTime < MIN_REFRESH_INTERVAL_MS) {
        return {
          status: "skipped",
          planHash: APPROVED_ONBOARDING_PLAN_HASH,
          verifiedAt: previous.verifiedAt,
        };
      }
    }

    await dependencies.client.ensureNote(plan.profile.ns, plan.profile.key, plan.profile.value);
    await dependencies.client.ensureNote(
      plan.contribution.ns,
      plan.contribution.key,
      plan.contribution.value,
    );
    const [profile, contribution] = await Promise.all([
      dependencies.client.readNote(plan.profile.ns, plan.profile.key),
      dependencies.client.readNote(plan.contribution.ns, plan.contribution.key),
    ]);
    if (profile !== plan.profile.value || contribution !== plan.contribution.value) {
      throw new Error("guarded refresh readback does not match the approved notes");
    }

    const verifiedAt = new Date(now).toISOString();
    state.receipts[GUARDED_RECEIPT_ID] = {
      taskId: GUARDED_RECEIPT_ID,
      planHash: APPROVED_ONBOARDING_PLAN_HASH,
      verifiedAt,
    };
    await save();
    return { status: "refreshed", planHash: APPROVED_ONBOARDING_PLAN_HASH, verifiedAt };
  });
}

function approvedPlanFromState(state: AgentState): OnboardPlan {
  const record = state.plans["technocore-onboard"] as { plan?: unknown } | undefined;
  const plan = record?.plan as OnboardPlan | undefined;
  if (!plan || typeof plan !== "object") throw new Error("approved onboarding plan is missing");
  return plan;
}

async function validateApprovedPlan(plan: OnboardPlan): Promise<void> {
  if (plan.planHash !== APPROVED_ONBOARDING_PLAN_HASH || plan.baseUrl !== APPROVED_ORIGIN) {
    throw new Error("plan does not match the approved guarded refresh policy");
  }
  const { planHash: _planHash, ...payload } = plan;
  if (await sha256Hex(JSON.stringify(payload)) !== APPROVED_ONBOARDING_PLAN_HASH) {
    throw new Error("plan does not match the approved guarded refresh policy");
  }

  const actualNotes = [plan.profile, plan.contribution];
  for (let index = 0; index < APPROVED_NOTES.length; index++) {
    const expected = APPROVED_NOTES[index];
    const actual = actualNotes[index];
    if (
      !actual || actual.ns !== expected.ns || actual.key !== expected.key ||
      actual.sha256 !== expected.sha256 || await sha256Hex(actual.value) !== expected.sha256
    ) {
      throw new Error("plan does not match the approved guarded refresh policy");
    }
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

if (import.meta.main) {
  try {
    if (Deno.args.length !== 0) throw new Error("guarded refresh accepts no arguments");
    const store = new LocalStateStore(GUARDED_RUNTIME_ROOT, undefined, false);
    const result = await guardedRefresh({
      store,
      client: new TechnocoreClient(APPROVED_ORIGIN),
      now: Date.now,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : "guarded refresh failed"}`);
    Deno.exitCode = 1;
  }
}
