export type KnownTaskId = "technocore-onboard";

const TASKS: Readonly<Record<KnownTaskId, string>> = {
  "technocore-onboard":
    "Publish the DID profile, contribution anchor, signed mailbox, and lobby proof.",
};

export function knownTaskIds(): KnownTaskId[] {
  return Object.keys(TASKS) as KnownTaskId[];
}

export function taskDescription(id: string): string | undefined {
  return TASKS[id as KnownTaskId];
}
