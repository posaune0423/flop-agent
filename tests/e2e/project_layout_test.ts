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
  assertEquals(agents.includes("secret-scan"), true);
  assertEquals(agents.includes("reachable Git history"), true);
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

Deno.test("ships complete Japanese operator documentation with language links", async () => {
  const englishPaths = ["README.md", "ops/README.md"];
  for await (const entry of Deno.readDir(`${root}/docs`)) {
    if (
      entry.isFile && entry.name.endsWith(".md") && !entry.name.endsWith("-ja.md") &&
      entry.name !== "AIRDROP_STRATEGY.md"
    ) {
      englishPaths.push(`docs/${entry.name}`);
    }
  }
  englishPaths.sort();

  for (const englishPath of englishPaths) {
    const separator = englishPath.lastIndexOf("/");
    const directory = separator >= 0 ? englishPath.slice(0, separator + 1) : "";
    const englishName = englishPath.slice(separator + 1);
    const japaneseName = englishName.replace(/\.md$/, "-ja.md");
    const japanesePath = `${directory}${japaneseName}`;
    assertEquals(await exists(`${root}/${japanesePath}`), true, japanesePath);
    const english = await Deno.readTextFile(`${root}/${englishPath}`);
    const japanese = await Deno.readTextFile(`${root}/${japanesePath}`);
    assertEquals(english.includes(`[日本語](${japaneseName})`), true, englishPath);
    assertEquals(japanese.includes(`[English](${englishName})`), true, japanesePath);

    const headingLevels = (document: string) =>
      [...document.matchAll(/^(#{1,6})\s+/gm)].map((match) => match[1].length);
    assertEquals(headingLevels(japanese), headingLevels(english), `${japanesePath}:headings`);
    const executableBlocks = (document: string) =>
      [...document.matchAll(/```(?:sh|bash|zsh)\n[\s\S]*?```/g)].map((match) => match[0]);
    assertEquals(
      executableBlocks(japanese),
      executableBlocks(english),
      `${japanesePath}:executable code blocks`,
    );
  }

  const requiredSections = {
    "README-ja.md": [
      "## できること",
      "## 必要条件",
      "## 環境変数",
      "## メールボックス",
      "## 公開 note の更新",
      "## 将来の FLOP タスクの追加",
      "## 開発",
      "## セキュリティモデル",
      "## 情報源",
      "## ライセンス",
    ],
    "docs/STRUCTURE-ja.md": [
      "## 概要",
      "## ディレクトリ構成",
      "## ソースの責務",
      "## 実行時フロー",
      "## 状態とシークレットの保存場所",
      "## 依存関係と権限のルール",
      "## 変更先の判断",
      "## 検証エントリーポイント",
    ],
    "docs/SECURITY_GUARDRAILS-ja.md": [
      "## 目的",
      "## 実装済みの制御",
      "### リポジトリのシークレットスキャン",
      "### 決定的なrefresh",
      "## 特権インストール境界",
      "## 人間が行う必要があるKeychain操作",
      "## 残存リスク",
    ],
    "ops/README-ja.md": [
      "## 前提条件",
      "## インストール時の所有権境界",
      "## スケジュールの意味",
      "## 人間による有効化",
      "## 検証",
      "## ロールバック",
    ],
  } as const;
  for (const [path, sections] of Object.entries(requiredSections)) {
    const document = await Deno.readTextFile(`${root}/${path}`);
    for (const section of sections) {
      assertEquals(document.includes(section), true, `${path}:${section}`);
    }
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

  const cli = await Deno.readTextFile(`${root}/src/cli.ts`);
  assertEquals(cli.includes("securityMigrate"), false);
  assertEquals(cli.includes('.command("security"'), false);
});

Deno.test("legacy migration guidance requires a separately reviewed immutable artifact", async () => {
  const guidance = await Deno.readTextFile(`${root}/docs/SECURITY_GUARDRAILS.md`);
  assertEquals(guidance.includes("agent:migrate"), false);
  assertEquals(guidance.includes("separately reviewed immutable migration artifact"), true);
  assertEquals(guidance.includes("Normal commands cannot discover or move legacy secrets"), true);
});

Deno.test("ci validates the guarded binary and launchd plist", async () => {
  const config = JSON.parse(await Deno.readTextFile(`${root}/deno.json`));
  const command = String(config.tasks.ci);
  const checkIndex = command.indexOf("deno task check");
  const compileIndex = command.indexOf("deno task guard:compile");

  assertEquals(checkIndex >= 0, true);
  assertEquals(compileIndex > checkIndex, true);
  assertEquals(command.includes("deno task check && deno task guard:compile"), true);
  assertEquals(command.includes("plutil"), false);

  const workflow = await Deno.readTextFile(`${root}/.github/workflows/ci.yml`);
  assertEquals(workflow.includes("runs-on: macos-latest"), true);
  assertEquals(
    workflow.includes(
      "/usr/bin/plutil -lint ops/io.github.posaune0423.flop-agent.refresh.plist",
    ),
    true,
  );
});

Deno.test("ci scans tracked files and reachable history for secrets", async () => {
  const workflow = await Deno.readTextFile(`${root}/.github/workflows/ci.yml`);
  const jobIndex = workflow.indexOf("  secret-scan:");

  assertEquals(jobIndex >= 0, true);
  const header = "  secret-scan:";
  const afterHeader = workflow.slice(jobIndex + header.length);
  const nextJobOffset = afterHeader.search(/\n {2}[a-z0-9-]+:\n/);
  const job = nextJobOffset === -1
    ? workflow.slice(jobIndex)
    : workflow.slice(jobIndex, jobIndex + header.length + nextJobOffset);
  assertEquals(job.includes("permissions:\n      contents: read"), true);
  assertEquals(job.includes("fetch-depth: 0"), true);
  assertEquals(
    job.includes("gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e"),
    true,
  );
  assertEquals(job.includes('GITLEAKS_ENABLE_COMMENTS: "false"'), true);
  assertEquals(job.includes('GITLEAKS_ENABLE_UPLOAD_ARTIFACT: "false"'), true);
  assertEquals(job.includes('GITLEAKS_ENABLE_SUMMARY: "false"'), true);
  assertEquals(job.includes('GITLEAKS_VERSION: "8.30.1"'), true);
  assertEquals(job.includes("GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}"), true);
  assertEquals(job.includes('gitleaks git --log-opts="--all" --redact=100 --no-banner .'), true);
  assertEquals(job.includes("tests/e2e/gitleaks_full_history.sh"), true);
  for (const bypass of ["continue-on-error", "|| true", "exit-code: 0"]) {
    assertEquals(job.includes(bypass), false, bypass);
  }

  const config = await Deno.readTextFile(`${root}/.gitleaks.toml`);
  const publicDidPatterns = [
    '^key:z6Mkv1o2GEgtXjFdEMfLtupcKhGRydM8V7VHzii7Uh4aHoqH"?$',
    '^key:z6MkwfNUQw8XipdgYceYRaiQxRue5k61sxHeZdQuLYQJH1Wj"?$',
  ];
  for (const pattern of publicDidPatterns) {
    assertEquals(config.includes(`'''${pattern}'''`), true, pattern);
  }
  assertEquals(config.includes("{40,120}"), false);
  assertEquals(
    publicDidPatterns.some((pattern) => new RegExp(pattern).test(`key:z${"1".repeat(48)}`)),
    false,
  );

  const coverage = await Deno.readTextFile(`${root}/tests/e2e/gitleaks_full_history.sh`);
  assertEquals(coverage.includes("merge --no-ff"), true);
  assertEquals(coverage.includes('--log-opts="--all"'), true);
  assertEquals(coverage.includes("--exit-code=42"), true);
});

Deno.test("all Technocore clients share one production origin constant", async () => {
  const constantPath = `${root}/src/constants/technocore.ts`;
  assertEquals(await exists(constantPath), true);
  const constant = await Deno.readTextFile(constantPath);
  assertEquals(
    constant.includes('export const TECHNOCORE_ORIGIN = "https://technocore.chat"'),
    true,
  );

  for (const sourcePath of ["src/cli.ts", "src/guarded_refresh.ts", "src/libs/technocore.ts"]) {
    const source = await Deno.readTextFile(`${root}/${sourcePath}`);
    assertEquals(source.includes("TECHNOCORE_ORIGIN"), true, sourcePath);
    assertEquals(source.includes("https://technocore.chat"), false, sourcePath);
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
  assertEquals(plist.includes("<key>KeepAlive</key>"), false);
  assertEquals(plist.includes("<key>RunAtLoad</key>"), false);

  const calendar = plist.match(
    /<key>StartCalendarInterval<\/key>\s*<array>([\s\S]*?)<\/array>/,
  )?.[1];
  assertEquals(typeof calendar, "string");
  const slotPattern =
    /<dict>\s*<key>Hour<\/key>\s*<integer>(\d+)<\/integer>\s*<key>Minute<\/key>\s*<integer>(\d+)<\/integer>\s*<\/dict>/g;
  const slotMatches = [...calendar!.matchAll(slotPattern)];
  assertEquals(slotMatches.length, 4);
  assertEquals(calendar!.replace(slotPattern, "").trim(), "");
  const slots = slotMatches.map((match) => ({
    hour: Number(match[1]),
    minute: Number(match[2]),
  }));
  assertEquals(slots, [
    { hour: 0, minute: 43 },
    { hour: 6, minute: 43 },
    { hour: 12, minute: 43 },
    { hour: 18, minute: 43 },
  ]);
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
