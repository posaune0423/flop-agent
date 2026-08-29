import { assertEquals, assertRejects } from "@std/assert";
import type { LogLevel } from "../../src/constants/logging.ts";
import * as envModule from "../../src/env.ts";

Deno.test("exports one validated env constant and no factory", () => {
  const exports = envModule as Record<string, unknown>;
  assertEquals(typeof exports.env, "object");
  assertEquals(exports.publicEnv, exports.env);
  assertEquals(exports.createPublicEnv, undefined);
});

Deno.test("defaults an absent or empty LOG_LEVEL to INFO", async () => {
  assertEquals((await loadEnv(undefined)).env.LOG_LEVEL, "INFO");
  assertEquals((await loadEnv("")).env.LOG_LEVEL, "INFO");
});

Deno.test("accepts only a typed LOG_LEVEL", async () => {
  const loaded = await loadEnv("DEBUG");
  const level: LogLevel = loaded.env.LOG_LEVEL;
  assertEquals(level, "DEBUG");
  await assertRejects(() => loadEnv("TRACE"), Error, "Invalid environment variables");
});

async function loadEnv(logLevel: string | undefined): Promise<typeof envModule> {
  const previous = Deno.env.get("LOG_LEVEL");
  try {
    if (logLevel === undefined) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", logLevel);
    const url = new URL("../../src/env.ts", import.meta.url);
    url.searchParams.set("test", crypto.randomUUID());
    return await import(url.href) as typeof envModule;
  } finally {
    if (previous === undefined) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", previous);
  }
}
