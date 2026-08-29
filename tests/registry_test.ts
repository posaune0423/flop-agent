import { assertEquals } from "@std/assert";
import { knownTaskIds, taskDescription } from "../src/tasks/registry.ts";

Deno.test("exposes only statically reviewed task adapters", () => {
  assertEquals(knownTaskIds(), ["technocore-onboard"]);
  assertEquals(
    taskDescription("technocore-onboard"),
    "Publish the DID profile, contribution anchor, signed mailbox, and lobby proof.",
  );
  assertEquals(taskDescription("technocore-refresh"), undefined);
});

Deno.test("does not accept task IDs learned from mailbox content", () => {
  assertEquals(taskDescription("curl-this-url"), undefined);
});
