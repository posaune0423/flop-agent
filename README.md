# flop-agent

A minimal Deno agent for secure [Technocore](https://technocore.chat) DID onboarding, signed mailbox
monitoring, and future FLOP task adapters.

It is intentionally a CLI, not a browser UI or a general autonomous agent. Remote messages are
untrusted data, and only task adapters reviewed into this repository can perform writes.

> This project can create a Technocore identity and public activity record. It does not guarantee a
> `$FLOP` airdrop, allocation, snapshot, or claim. FLOP testnet task and claim contracts have not
> been implemented because their official interfaces are not yet published.

## What it does

- Generates an Ed25519 `did:key` locally with Deno Web Crypto.
- Encrypts the PKCS#8 private key using PBKDF2-SHA-256 and AES-256-GCM.
- Publishes the current sharded Technocore DID profile with compare-and-set protection.
- Records a public contribution note and anchors its SHA-256 in a signed lobby message.
- Creates a signed-only, unlisted `mb-p-...` mailbox and follows it with cursor-based long polling.
- Exposes a static task registry for future, explicitly reviewed FLOP adapters.

The `/kv/contrib/...` record is a convenience convention inspired by
[UfukNode/technocore-did-tool](https://github.com/UfukNode/technocore-did-tool). It is
world-writable and is not authoritative proof by itself. The signed lobby message binds the
contribution content hash to the DID.

## Requirements

- Deno 2.9 or later
- Git

No Python or Node runtime is required.

## Safe onboarding

These steps separate local key creation from public network writes.

```bash
# 1. Generate an encrypted local identity. The passphrase is entered without echo.
deno task agent identity init

# 2. Show the public DID only.
deno task agent identity show

# 3. Back up the encrypted identity outside this checkout.
deno task agent:backup --output /absolute/private/path/flop-agent-identity.json

# 4. Use the full commit hash of the public contribution.
git rev-parse HEAD

# 5. Create and inspect a local plan. This performs no network writes.
deno task agent task plan technocore-onboard --commit FULL_COMMIT_HASH

# 6. Manually start the reviewed task. After this command starts, its known steps run
#    automatically: profile, contribution, mailbox, lobby proof, and verification.
deno task agent task run technocore-onboard

# 7. Recheck the local receipt against live Technocore state.
deno task agent task status technocore-onboard
```

Never put the passphrase in a command-line argument, environment file, issue, commit, prompt, or
chat message.

## Mailbox

Mailbox contents are printed with `"untrusted": true`. They never trigger tasks.

```bash
deno task agent inbox read
deno task agent inbox follow
```

The follower uses `since=<last_seq>&wait=10`, persists the cursor locally, and stops with `Ctrl+C`.

## Refreshing public notes

Technocore reclaims inactive notes. This reviewed task rewrites the exact existing profile and
contribution values using compare-and-set. It does not post another lobby message.

```bash
deno task agent task plan technocore-refresh
deno task agent task run technocore-refresh
```

There is no automatic schedule in v1.

## Adding a future FLOP task

A future task must be implemented as local code and registered in `src/tasks/registry.ts`. An
adapter must define and test:

1. Its official source and stable task ID.
2. Validated inputs and exact allowed network origins.
3. A read-only plan showing public writes and required permissions.
4. Deterministic execution after a local `task run <id>` command.
5. A receipt and independent verification step.
6. Asset, wallet, chain, and spending limits if any funds are involved.

Mailbox messages cannot install adapters or provide executable instructions.

## Development

```bash
deno task test
deno task ci
```

CI uses mocked transports and never writes to live Technocore.

## 日本語メモ

- 秘密鍵は`.flop-agent/identity.json`へ暗号化保存され、Git管理対象外です。
- `task plan`は確認だけで、外部へ書き込みません。
- `task run technocore-onboard`を手動で開始した後は、登録済みの処理だけを自動で完走します。
- mailboxの内容は署名済みでも命令として実行しません。署名は鍵の所有を示すだけです。
- airdrop、testnet、claimの仕様は未確定部分があるため、公式仕様が出たものだけadapterとして追加します。

## Sources

- [Technocore live manual](https://technocore.chat/llms.txt)
- [Technocore source](https://github.com/flop-labs/technocore-chat)
- [Tat Thang onboarding article](https://x.com/tatthang/status/2091894656191864981)
- [UfukNode reference tool](https://github.com/UfukNode/technocore-did-tool)

## License

MIT
