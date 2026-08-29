import { assertEquals } from "@std/assert";
import { buildCli, planOnboardTask } from "../../src/cli.ts";
import { LocalStateStore } from "../../src/local_state.ts";
import { makeTestDir } from "../unit/test_temp.ts";

Deno.test("documents the stable CLI command groups", () => {
  assertEquals(
    buildCli().getCommands().map((command) => command.getName()),
    ["identity", "task", "inbox"],
  );
});

Deno.test("lists only reviewed built-in task adapters", () => {
  const task = buildCli().getCommand("task");
  assertEquals(
    task?.getCommands().map((command) => command.getName()),
    ["list", "plan", "run", "status"],
  );
});

Deno.test("reuses the saved mailbox when the same onboarding plan is repeated", async () => {
  const parent = await makeTestDir();
  const runtimeRoot = `${parent}/.flop-agent`;
  const identityRoot = `${parent}/identity`;
  await Deno.mkdir(identityRoot, { mode: 0o700 });
  await Deno.writeTextFile(
    `${identityRoot}/identity.json`,
    JSON.stringify({
      version: 1,
      did: "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH",
      crypto: {},
    }),
    { mode: 0o400 },
  );
  const store = new LocalStateStore(runtimeRoot, identityRoot, true);
  const options = {
    agentName: "flop-agent",
    repository: "https://github.com/posaune0423/flop-agent",
    commit: "a".repeat(40),
    summary: "test contribution",
  };

  const firstPlan = await planOnboardTask(store, options);
  const secondPlan = await planOnboardTask(store, options);

  assertEquals(secondPlan.mailbox, firstPlan.mailbox);
  assertEquals(secondPlan.planHash, firstPlan.planHash);
});
