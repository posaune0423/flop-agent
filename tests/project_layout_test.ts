import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const root = fromFileUrl(new URL("..", import.meta.url));

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

Deno.test("backup task can inspect an arbitrary absolute output directory", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  const command = String(config.tasks["agent:backup"]);

  assertEquals(command.includes("--allow-read "), true);
  assertEquals(command.includes("--allow-write "), true);
});
