import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const root = fromFileUrl(new URL("../..", import.meta.url));

Deno.test("vendors the recorded Technocore project skill exactly", async () => {
  const metadata = JSON.parse(
    await Deno.readTextFile(`${root}/.agents/skills/technocore-chat/UPSTREAM.json`),
  );
  const bytes = await Deno.readFile(`${root}/.agents/skills/technocore-chat/SKILL.md`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  assertEquals(actual, metadata.sha256);
});

Deno.test("shares one canonical agents tree across supported coding agents", async () => {
  for (const parent of [".cursor", ".claude", ".codex"]) {
    for (const child of ["skills", "commands", "rules"]) {
      assertEquals(await Deno.readLink(`${root}/${parent}/${child}`), `../.agents/${child}`);
    }
  }
  assertEquals(await Deno.readLink(`${root}/CLAUDE.md`), "AGENTS.md");
});

Deno.test("agents load the structure ownership contract", async () => {
  const agents = await Deno.readTextFile(`${root}/AGENTS.md`);
  const structure = await Deno.readTextFile(`${root}/docs/STRUCTURE.md`);

  assertEquals(agents.includes("Read `docs/STRUCTURE.md`"), true);
  for (
    const section of [
      "## Overview",
      "## Directory layout",
      "## Source ownership",
      "## Runtime flows",
      "## Dependency and capability rules",
      "## Where changes go",
    ]
  ) {
    assertEquals(structure.includes(section), true, section);
  }
});

Deno.test("uses the standard libs, constants, utils, and test-suite layout", async () => {
  for (
    const required of [
      "src/libs/technocore.ts",
      "src/constants/guarded_refresh.ts",
      "src/constants/logging.ts",
      "src/utils/logger.ts",
      "tests/unit",
      "tests/integration",
      "tests/e2e",
    ]
  ) {
    assertEquals(await exists(`${root}/${required}`), true, required);
  }
  assertEquals(await exists(`${root}/src/technocore.ts`), false);

  const logger = await Deno.readFile(`${root}/src/utils/logger.ts`);
  const digest = await crypto.subtle.digest("SHA-256", logger);
  const actual = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  assertEquals(actual, "80d147ef912e57459ca499f3dddc596e2da6a2770747ffc7e322d864227b0a98");

  for await (const entry of Deno.readDir(`${root}/tests`)) {
    assertEquals(entry.isFile && entry.name.endsWith("_test.ts"), false, entry.name);
  }
});

Deno.test("mutable source tasks have no protected identity capability", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  for (
    const removed of [
      "agent:identity-init",
      "agent:identity-show",
      "agent:backup",
      "agent:migrate",
    ]
  ) {
    assertEquals(config.tasks[removed], undefined, removed);
  }
  for (const [name, value] of Object.entries(config.tasks)) {
    assertEquals(String(value).includes("Application Support/flop-agent"), false, name);
  }
});

Deno.test("guarded refresh source excludes identity, commands, and environment", async () => {
  assertEquals(await exists(`${root}/src/guarded_refresh.ts`), true);
  const source = await Deno.readTextFile(`${root}/src/guarded_refresh.ts`);
  const policy = await Deno.readTextFile(`${root}/src/constants/guarded_refresh.ts`);
  assertEquals(
    policy.includes("da3c27957b0f7e03e1f5d35f7f9623c739f8e7cfcec2f414890a16812b85749e"),
    true,
  );
  assertEquals(source.includes('from "./constants/guarded_refresh.ts"'), true);
  assertEquals(source.includes('from "./identity.ts"'), false);
  assertEquals(source.includes("Deno.Command"), false);
  assertEquals(source.includes("Deno.env"), false);
});

Deno.test("interactive identity material is destroyed after use", async () => {
  const source = await Deno.readTextFile(`${root}/src/cli.ts`);
  assertEquals(source.includes("identity.destroy()"), true);
  assertEquals(source.includes("unlocked.destroy()"), true);
  assertEquals(source.includes('from "./utils/logger.ts"'), true);
});

Deno.test("local tests cannot spawn subprocesses or inspect host secrets", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  const command = String(config.tasks.test);
  for (const allowed of ["src", "tests", "deno.json", "AGENTS.md", "ops", ".agents"]) {
    assertEquals(command.includes(allowed), true, allowed);
  }
  assertEquals(command.includes("--allow-write=.test-tmp"), true);
  assertEquals(
    command.split(" ").filter((token) => token.startsWith("--allow-env")),
    ["--allow-env=LOG_LEVEL"],
  );
  for (
    const forbidden of [
      "--allow-read=.",
      "--allow-read ",
      "--allow-write ",
      "--allow-run",
      "--allow-net",
      "--allow-all",
      " -A",
    ]
  ) {
    assertEquals(command.includes(forbidden), false, forbidden);
  }
});

Deno.test("scheduled refresh builds as a fixed root-installable capability binary", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  const command = String(config.tasks["guard:compile"]);
  for (
    const required of [
      "deno compile",
      "--no-prompt",
      "--allow-sys=uid",
      "--allow-read=/var/db/flop-agent-refresh",
      "--allow-write=/var/db/flop-agent-refresh/runtime",
      "--allow-net=technocore.chat:443",
      "src/guarded_refresh.ts",
    ]
  ) {
    assertEquals(command.includes(required), true, required);
  }
  for (const forbidden of ["--allow-env", "--allow-run", "--allow-ffi", "--allow-all", " -A"]) {
    assertEquals(command.includes(forbidden), false, forbidden);
  }

  const policy = await Deno.readTextFile(`${root}/src/constants/guarded_refresh.ts`);
  assertEquals(policy.includes("/var/db/flop-agent-refresh"), true);

  const plist = await Deno.readTextFile(
    `${root}/ops/io.github.posaune0423.flop-agent.refresh.plist`,
  );
  assertEquals(plist.includes("/usr/local/libexec/flop-agent-refresh"), true);
  assertEquals(plist.includes("_floprefresh"), true);
  assertEquals(plist.includes("/bin/sh"), false);
  assertEquals(plist.includes(root), false);
});

Deno.test("mutable source tasks have no protocol network capability", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  for (
    const removed of [
      "agent:onboard",
      "agent:status",
      "agent:inbox",
      "agent:refresh-guarded",
    ]
  ) {
    assertEquals(config.tasks[removed], undefined, removed);
  }
  for (const [name, value] of Object.entries(config.tasks)) {
    if (name === "guard:compile") continue;
    assertEquals(String(value).includes("--allow-net"), false, name);
  }
});

Deno.test("mutable source receives only the non-secret LOG_LEVEL environment variable", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  for (const [name, value] of Object.entries(config.tasks)) {
    const envFlags = String(value).split(" ").filter((token) => token.startsWith("--allow-env"));
    const expected = name === "agent" || name === "test" ? ["--allow-env=LOG_LEVEL"] : [];
    assertEquals(envFlags, expected, name);
  }
});

Deno.test("legacy state migration locks the old writer before moving files", async () => {
  const source = await Deno.readTextFile(`${root}/src/local_state.ts`);
  const lockIndex = source.indexOf("await legacyLock.lock(true)");
  const moveIndex = source.indexOf("await migrateLegacyFile(\n          legacyStatePath");
  assertEquals(lockIndex >= 0, true);
  assertEquals(moveIndex >= 0, true);
  assertEquals(lockIndex < moveIndex, true);
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return false;
    throw error;
  }
}
