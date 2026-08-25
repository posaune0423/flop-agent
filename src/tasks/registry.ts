export type KnownTaskId = "technocore-onboard" | "technocore-refresh";

const TASKS: Readonly<Record<KnownTaskId, string>> = {
  "technocore-onboard":
    "Publish the DID profile, contribution anchor, signed mailbox, and lobby proof.",
  "technocore-refresh": "Refresh the existing profile and contribution notes without lobby spam.",
};

export function knownTaskIds(): KnownTaskId[] {
  return Object.keys(TASKS) as KnownTaskId[];
}

export function taskDescription(id: string): string | undefined {
  return TASKS[id as KnownTaskId];
}
