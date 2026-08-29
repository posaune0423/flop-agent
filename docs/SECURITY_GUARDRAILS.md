# Security Guardrails

Last verified: 2026-08-29 (Asia/Tokyo)

## Objective

No prompt, model judgment, mailbox message, X post, or mutable checkout is an authorization
boundary. Private identity access and scheduled protocol writes must be constrained by filesystem,
runtime, and OS capabilities outside LLM inference.

## Implemented controls

### Codex host access

- Global Codex defaults are `approval_policy = "on-request"` and `sandbox_mode = "workspace-write"`
  for new sessions.
- All three local FLOP LLM automations are `PAUSED`.
- The current session was started before that global change and retains its original permissions;
  restart Codex before treating the new defaults as active.

### Secret/runtime separation

- Encrypted identity: `~/Library/Application Support/flop-agent/identity.json`
- Runtime state: `.flop-agent/runtime/`
- Identity directory mode: `0700`; identity file mode: `0400`.
- Runtime directories are `0700`; state and lock files are `0600`.
- Existing paths are checked with `lstat`; symlinks, non-regular files, wrong owner, group/other
  permissions, and multiple hard links fail closed.
- Migration is an explicit `deno task agent:migrate` operation. Normal commands cannot discover or
  move legacy secrets.

### Split Deno capabilities

The generic `deno task agent` has no host permissions. No task that runs mutable checkout source has
identity, Keychain, environment, network, or subprocess capability. Identity creation, inspection,
backup, migration, onboarding, status, inbox, and refresh require separately reviewed immutable
artifacts; only guarded refresh currently has one.

Tests have repository read, `.test-tmp` write, and UID metadata only. They have no environment,
network, subprocess, FFI, or host-wide filesystem capability.

### Key material lifetime

- `UnlockedIdentity` no longer exposes its PKCS#8 bytes.
- Signing uses a non-extractable `CryptoKey` after import.
- Temporary PKCS#8 buffers are overwritten where JavaScript permits.
- Interactive identity objects are destroyed in `finally` after encryption or task execution.
- JavaScript strings and runtime memory cannot be guaranteed to be erased. Identity unlock remains
  manual and must not occur in an LLM-controlled or logged terminal.

### Deterministic refresh

`src/guarded_refresh.ts` is fixed to:

- `https://technocore.chat`
- onboarding plan hash `da3c27957b0f7e03e1f5d35f7f9623c739f8e7cfcec2f414890a16812b85749e`
- exactly the approved profile and contribution note coordinates and value hashes
- a minimum five-day interval
- readback before writing a local receipt

Plan, origin, target, or value tampering fails before the first network call. Redirects are
rejected, and untrusted response bodies are not copied into logs.

`deno task guard:compile` embeds source and dependencies into one binary with only:

- read: `/var/db/flop-agent-refresh`
- write: `/var/db/flop-agent-refresh/runtime`
- network: `technocore.chat:443`
- system metadata: UID

It has no identity, environment, subprocess, FFI, shell, GitHub, or arbitrary host capability.

## Privileged installation boundary

The compiled artifact is not automatically installed. A production schedule is enabled only after
the steps in [`ops/README.md`](../ops/README.md) are completed from a human-controlled administrator
terminal:

- root-owned binary and LaunchDaemon plist
- dedicated non-login `_floprefresh` user
- service-owned public runtime state
- no checkout path and no encrypted identity in the service account

A user LaunchAgent is not an OS isolation boundary and must not be used.

## Keychain action still requiring the human

A generic-password item for the identity passphrase already exists in the login Keychain. Its secret
was not retrieved during this work. Because changing or deleting it can make the identity unusable,
an LLM must not perform that operation.

After confirming the passphrase is known independently, use Keychain Access from a non-agent session
to either:

1. require confirmation for every access and remove command-line tools from its allowlist, or
2. delete the Keychain item and enter the passphrase manually when explicitly signing.

Never run `security find-generic-password -w` from Codex or place the passphrase in arguments,
environment variables, files, prompts, logs, or chat.

## Residual risks

- A currently running full-access Codex session keeps its launch-time authority until restarted.
- Admin/root/kernel compromise, keyloggers, screen capture, and malicious reviewed binaries remain
  out of scope.
- The interactive onboarding process still combines signing and the exact Technocore network
  capability. A separate user-presence signer service is required before adding any future
  autonomous signed task.
- DNS/TLS or Technocore compromise can affect the approved origin, although exact target hashes,
  CAS, redirect rejection, request timeout, and readback reduce impact.
