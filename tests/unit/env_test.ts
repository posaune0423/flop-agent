import { assertEquals, assertThrows } from "@std/assert";
import type { LogLevel } from "../../src/constants/logging.ts";
import { createPublicEnv } from "../../src/env.ts";

Deno.test("exports a type-safe environment factory", () => {
  assertEquals(typeof createPublicEnv, "function");
});

Deno.test("defaults an absent or empty LOG_LEVEL to INFO", () => {
  assertEquals(createPublicEnv({}).LOG_LEVEL, "INFO");
  assertEquals(createPublicEnv({ LOG_LEVEL: "" }).LOG_LEVEL, "INFO");
});

Deno.test("accepts only a typed LOG_LEVEL", () => {
  const env = createPublicEnv({ LOG_LEVEL: "DEBUG" });
  const level: LogLevel = env.LOG_LEVEL;
  assertEquals(level, "DEBUG");
  assertThrows(() => createPublicEnv({ LOG_LEVEL: "TRACE" }), Error);
});
