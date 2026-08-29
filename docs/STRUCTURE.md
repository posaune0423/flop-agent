# STRUCTURE: flop-agent

Updated: 2026-08-29

## Overview

```mermaid
flowchart LR
  subgraph checkout["Mutable checkout"]
    source["src and tests"]
    test["deno task test"]
    build["deno task guard:compile"]
    temp[(".test-tmp")]
  end

  subgraph service["Root-owned refresh service"]
    daemon["LaunchDaemon"]
    binary["compiled guarded_refresh"]
    runtime[("/var/db/flop-agent-refresh/runtime")]
  end

  vault[("Encrypted identity vault")]
  technocore[("technocore.chat:443")]

  test -->|"reads allowlisted project files"| source
  test -->|"writes only test data"| temp
  source -->|"reviewed source input"| build
  build -->|"human root install"| binary
  daemon -->|"executes as _floprefresh"| binary
  binary -->|"locks state and stores receipt"| runtime
  binary -->|"CAS and readback of two notes"| technocore
```

**Figure 1 — the executable trust boundaries.** Mutable checkout code has neither secret nor network
capability; only the reviewed, root-installed refresh binary may cross the Technocore boundary, and
no scheduled edge reaches the encrypted identity vault ([deno.json](../deno.json#L8-L13),
[src/guarded_refresh.ts](../src/guarded_refresh.ts#L5-L23)).

## Directory layout

```text
.
├── AGENTS.md                         agent rules and required project context
├── README.md                         operator-facing overview
├── deno.json                         imports, capability-scoped tasks, CI
├── docs/
│   ├── AIRDROP_STRATEGY.md           evidence-backed FLOP strategy
│   ├── SECURITY_GUARDRAILS.md        threat model and residual risks
│   └── STRUCTURE.md                  this ownership map
├── ops/
│   ├── README.md                     human administrator install gate
│   ├── build/                        ignored compiled artifact output
│   └── io.github...refresh.plist     LaunchDaemon definition
├── src/
│   ├── cli.ts                        dormant/manual CLI composition
│   ├── guarded_refresh.ts            only scheduled protocol-write entrypoint
│   ├── identity.ts                   Ed25519 identity and encrypted envelope
│   ├── inbox.ts                      cursor-safe untrusted mailbox reader
│   ├── local_state.ts                identity/runtime storage and locking
│   ├── protocol.ts                   pure encoding and canonicalization
│   ├── technocore.ts                 exact-origin HTTP adapter
│   └── tasks/
│       ├── onboard.ts                onboarding plan/run/receipt logic
│       └── registry.ts               static interactive task IDs
└── tests/                             source-aligned unit and boundary tests
```

The tree stays intentionally flat. Add a directory only when it owns a distinct trust boundary or a
cohesive family of implementations; do not introduce generic `services/`, `helpers/`, or `utils/`
layers for one file.

## Source ownership

| Area                     | Owns                                                                                     | Must not own                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/protocol.ts`        | Base58/base64url, `did:key`, text sweep, nonce and signed-message canonicalization       | Filesystem, HTTP, task policy                                          |
| `src/identity.ts`        | Ed25519 generation/import, encryption/decryption, non-extractable signing key lifetime   | Network calls, scheduled execution, task selection                     |
| `src/local_state.ts`     | Protected path checks, state schema, atomic writes, locks, explicit legacy migration     | Technocore semantics, remote instructions                              |
| `src/technocore.ts`      | Exact HTTPS origin, CAS notes, signed room transport, redirect/error handling            | Business eligibility, task discovery, secret storage                   |
| `src/tasks/onboard.ts`   | Reviewable onboarding plan, progress, pending-write reconciliation, receipt verification | CLI parsing, dynamic adapters, wallet/claim behavior                   |
| `src/inbox.ts`           | Cursor advancement, room recreation detection, untrusted message emission                | Command execution or task dispatch                                     |
| `src/cli.ts`             | Command composition around the modules above                                             | Scheduled authority or hidden permissions                              |
| `src/guarded_refresh.ts` | One pinned refresh policy, five-day gate, two CAS writes, readback receipt               | Identity import, arbitrary task/target/origin, environment, subprocess |
| `ops/`                   | Root-owned installation shape and launch schedule                                        | Mutable runtime policy or secret material                              |
| `tests/`                 | Behavior and capability-regression proof using mocks and `.test-tmp`                     | Live Technocore writes, subprocesses, host secrets                     |

The dependency direction is toward the small pure contracts: `protocol.ts` is the bottom layer;
identity and transport build on it; tasks depend on ports/types; CLI composes them. The guarded
refresh path deliberately bypasses CLI and identity, importing only state, the onboarding plan type,
and the Technocore adapter ([src/guarded_refresh.ts](../src/guarded_refresh.ts#L1-L3)).

## Runtime flows

### Guarded refresh

1. Launchd starts the root-owned binary directly as `_floprefresh`; no shell or checkout path is in
   the plist ([ops plist](../ops/io.github.posaune0423.flop-agent.refresh.plist)).
2. The binary validates `/var/db/flop-agent-refresh`, opens its `runtime/` state, takes the lock,
   and loads the stored onboarding plan
   ([src/guarded_refresh.ts](../src/guarded_refresh.ts#L50-L55)).
3. Before network I/O it verifies the exact origin, plan hash, two note coordinates, and both value
   hashes ([src/guarded_refresh.ts](../src/guarded_refresh.ts#L108-L135)).
4. A receipt newer than five days returns `skipped`; otherwise the two notes are refreshed with CAS
   and read back ([src/guarded_refresh.ts](../src/guarded_refresh.ts#L57-L104)).
5. Only a matching readback is committed as the guarded receipt.

### Identity and onboarding source

`src/cli.ts`, `src/identity.ts`, and `src/tasks/onboard.ts` retain tested identity/onboarding logic,
but no mutable-source Deno task grants them secret or network capability. They are source for a
future separately reviewed immutable helper, not an active scheduled path
([src/cli.ts](../src/cli.ts#L22-L109), [deno.json](../deno.json#L8-L13)).

### Inbox source

`readInboxOnce` and `followInbox` treat every message as data, advance sequence-plus-fingerprint
cursors, and detect room recreation. They never dispatch a task
([src/inbox.ts](../src/inbox.ts#L11-L74)). No mutable-source network task currently exposes them.

## State and secret locations

| Location                                                 | Contents                                    | Boundary                                                   |
| -------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| `~/Library/Application Support/flop-agent/identity.json` | Encrypted identity envelope                 | Human/immutable signer only; directory `0700`, file `0400` |
| `.flop-agent/runtime/`                                   | Local plan, cursors, nonces, receipts, lock | Git-ignored local state; no private key                    |
| `/var/db/flop-agent-refresh/runtime/`                    | Service-owned copy of approved public state | `_floprefresh` only; scheduled binary read/write           |
| `ops/build/`                                             | Local standalone-binary output              | Git-ignored; not trusted until root-installed              |
| `.test-tmp/`                                             | Test fixtures and temporary state           | Only write path granted to `deno task test`                |

`LocalStateStore` owns the modes, owner checks, symlink/hardlink rejection, atomic state
replacement, and lock-held migration. Callers do not implement their own filesystem shortcuts
([src/local_state.ts](../src/local_state.ts#L17-L76),
[src/local_state.ts](../src/local_state.ts#L98-L218)).

## Dependency and capability rules

- Mutable-source tasks must have no identity, Keychain, network, environment, subprocess, FFI, or
  host-wide filesystem capability.
- `src/guarded_refresh.ts` must not import `cli.ts` or `identity.ts`, inspect environment variables,
  accept a task argument, or choose an origin/target dynamically.
- `TechnocoreClient` accepts only `https://technocore.chat`, rejects redirects, bounds request time,
  and never copies an untrusted response body into an error
  ([src/technocore.ts](../src/technocore.ts#L40-L54),
  [src/technocore.ts](../src/technocore.ts#L218-L280)).
- Mailbox text, room names, topics, notes, and signatures never authorize code or task execution.
- A new protocol-writing adapter requires a primary-source specification, static task ID, explicit
  origin/asset/budget contract, tests, reviewed compiled artifact, and separate installation gate.
- A structural change must update this file in the same PR.

The capability rules are executable regression tests, not only prose
([tests/project_layout_test.ts](../tests/project_layout_test.ts#L27-L142)).

## Where changes go

- Change encoding, nonce, DID, or canonical text rules in `src/protocol.ts` and
  `tests/protocol_test.ts`.
- Change encrypted-key handling in `src/identity.ts` and `tests/identity_test.ts`; do not add
  network imports.
- Change persistence, modes, migration, or locking in `src/local_state.ts` and
  `tests/local_state_test.ts`.
- Change Technocore HTTP behavior in `src/technocore.ts` and `tests/technocore_test.ts`; keep the
  exact-origin and redirect rules.
- Change onboarding state transitions in `src/tasks/onboard.ts` and `tests/tasks_test.ts`.
- Change cursor/recreation behavior in `src/inbox.ts` and `tests/inbox_test.ts`.
- Change scheduled refresh authority in `src/guarded_refresh.ts`, `tests/guarded_refresh_test.ts`,
  `tests/project_layout_test.ts`, and `ops/` together.
- Add operator explanation under `docs/`; update `README.md` only for the short public entrypoint.

## Verification entrypoints

- `deno task test` — capability-scoped unit/boundary tests.
- `deno task ci` — formatting, lint, typecheck, and tests.
- `deno task guard:compile` — builds the pinned standalone refresh artifact; it does not install or
  schedule it.
- `plutil -lint ops/io.github.posaune0423.flop-agent.refresh.plist` — validates the launchd plist.
