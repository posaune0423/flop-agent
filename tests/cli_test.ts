import { assertEquals, assertStringIncludes } from "@std/assert";
import { fromFileUrl } from "@std/path";

const root = fromFileUrl(new URL("..", import.meta.url));

async function runCli(...args: string[]) {
  return await new Deno.Command(Deno.execPath(), {
    args: ["run", "--quiet", "src/cli.ts", ...args],
    cwd: root,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

async function runCliIn(cwd: string, ...args: string[]) {
  return await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--quiet",
      "--allow-read=.flop-agent",
      "--allow-write=.flop-agent",
      `${root}/src/cli.ts`,
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();
}

Deno.test("documents the stable CLI command groups", async () => {
  const output = await runCli("--help");
  const text = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  for (const command of ["identity", "task", "inbox"]) assertStringIncludes(text, command);
});

Deno.test("lists only reviewed built-in task adapters", async () => {
  const output = await runCli("task", "list");
  const text = new TextDecoder().decode(output.stdout);

  assertEquals(output.code, 0);
  assertStringIncludes(text, "technocore-onboard");
  assertStringIncludes(text, "technocore-refresh");
});

Deno.test("reuses the saved mailbox when the same onboarding plan command is repeated", async () => {
  const cwd = await Deno.makeTempDir();
  await Deno.mkdir(`${cwd}/.flop-agent`, { mode: 0o700 });
  await Deno.writeTextFile(
    `${cwd}/.flop-agent/identity.json`,
    JSON.stringify({
      version: 1,
      did: "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH",
      crypto: {},
    }),
  );
  const args = ["task", "plan", "technocore-onboard", "--commit", "a".repeat(40)];

  const shown = await runCliIn(cwd, "identity", "show");
  assertEquals(shown.code, 0, new TextDecoder().decode(shown.stderr));
  assertEquals(JSON.parse(new TextDecoder().decode(shown.stdout)), {
    did: "did:key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH",
    fingerprint: "83c44d7b9324fb98",
  });

  const first = await runCliIn(cwd, ...args);
  const second = await runCliIn(cwd, ...args);

  assertEquals(first.code, 0, new TextDecoder().decode(first.stderr));
  assertEquals(second.code, 0, new TextDecoder().decode(second.stderr));
  const firstPlan = JSON.parse(new TextDecoder().decode(first.stdout));
  const secondPlan = JSON.parse(new TextDecoder().decode(second.stdout));
  assertEquals(secondPlan.mailbox, firstPlan.mailbox);
  assertEquals(secondPlan.planHash, firstPlan.planHash);
});
