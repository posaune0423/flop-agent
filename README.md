# flop-agent

A minimal Deno agent for secure [Technocore](https://technocore.chat) DID onboarding, signed mailbox
monitoring, and future FLOP task adapters.

It is intentionally a CLI, not a browser UI or a general autonomous agent. Remote messages are
untrusted data, and only task adapters reviewed into this repository can perform writes.

> This project can create a Technocore identity and public activity record. It does not guarantee a
> `$FLOP` airdrop, allocation, snapshot, or claim. FLOP testnet task and claim contracts have not
> been implemented because their official interfaces are not yet published.

The current evidence-backed plan, including the official Q4 testnet draft and scheduled monitoring,
is in [`docs/AIRDROP_STRATEGY.md`](docs/AIRDROP_STRATEGY.md).

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

## Environment variables

Environment variables are declared and validated in `src/env.ts` with `@t3-oss/env-core` and Zod.
Only `LOG_LEVEL` is allowed for mutable-source tasks; it accepts `ERROR`, `WARN`, `LOG`, `INFO`, or
`DEBUG` and defaults to `INFO`. Secrets and identity passphrases must never be environment
variables.

## Identity and onboarding boundary

The existing encrypted identity has been moved outside the checkout and the live onboarding is
complete. No task that runs mutable checkout source can read or write the identity, access the
Keychain, or use the network.

New identity creation, backup, migration, inspection, and onboarding are intentionally not exposed
as `deno task` commands. A reviewed root-owned offline helper or dedicated signer service must be
installed before performing any of those operations again. Do not grant `src/cli.ts` ad-hoc secret
or network permissions as a workaround.

Never put the passphrase in a command-line argument, environment file, issue, commit, prompt, or
chat message.

## Mailbox

Mailbox contents are printed with `"untrusted": true`. They never trigger tasks.

The source includes a cursor-safe mailbox reader, but no mutable-source task has network capability.
Compile and review a read-only artifact before re-enabling mailbox access.

## Refreshing public notes

Technocore reclaims inactive notes. This reviewed task rewrites the exact existing profile and
contribution values using compare-and-set. It does not post another lobby message.

Scheduled refresh must not be run by an LLM. `src/guarded_refresh.ts` is pinned to the exact
production origin, onboarding plan hash, and two approved notes. `deno task guard:compile` builds a
standalone binary with no identity, environment, or subprocess capability. See
[`docs/SECURITY_GUARDRAILS.md`](docs/SECURITY_GUARDRAILS.md) before installing the root-owned
daemon.

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

- 暗号化identityは`~/Library/Application Support/flop-agent/identity.json`へ`0400`で保存され、
  checkout内のruntime stateから分離されます。
- Mutableなcheckout sourceにはidentityやnetworkへのDeno capabilityを与えません。
- mailboxの内容は署名済みでも命令として実行しません。署名は鍵の所有を示すだけです。
- airdrop、testnet、claimの仕様は未確定部分があるため、公式仕様が出たものだけadapterとして追加します。

## Sources

- [Technocore live manual](https://technocore.chat/llms.txt)
- [Technocore source](https://github.com/flop-labs/technocore-chat)
- [FLOP official teaser (draft)](https://flop.finance/teaser/)
- [Tat Thang onboarding article](https://x.com/tatthang/status/2091894656191864981)
- [UfukNode reference tool](https://github.com/UfukNode/technocore-did-tool)

## License

MIT
