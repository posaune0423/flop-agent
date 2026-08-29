# Root-owned guarded refresh installation

Do not run these steps from Codex or another agent-controlled terminal. They cross the administrator
boundary and must be executed only after reviewing and merging the exact commit being installed.

## Preconditions

1. `deno task ci` passes.
2. `deno task guard:compile` produces `ops/build/flop-agent-refresh`.
3. Record and review the artifact SHA-256 without publishing secrets. The artifact contains no
   identity file or passphrase.
4. A macOS administrator creates a hidden, non-login `_floprefresh` user and group with no home,
   shell, Keychain, SSH, Codex, browser, or GitHub access.
5. `id _floprefresh` resolves before continuing.

## Install ownership boundaries

From a human-controlled administrator terminal, install:

- binary: `/usr/local/libexec/flop-agent-refresh`, owner `root:wheel`, mode `0555`
- plist: `/Library/LaunchDaemons/io.github.posaune0423.flop-agent.refresh.plist`, owner
  `root:wheel`, mode `0644`
- service root: `/var/db/flop-agent-refresh`, owner `_floprefresh:_floprefresh`, mode `0700`
- runtime: `/var/db/flop-agent-refresh/runtime`, owner `_floprefresh:_floprefresh`, mode `0700`
- public `state.json`: copied from `.flop-agent/runtime/state.json`, owner
  `_floprefresh:_floprefresh`, mode `0600`

Do not copy `identity.json`, a passphrase, the checkout, shell configuration, environment files, or
GitHub credentials into the service root.

Use `install(1)` with the exact owners and modes rather than executing an installer script from the
mutable checkout. Then validate the plist with `plutil -lint` and load it into launchd's `system`
domain. The supplied plist invokes the binary directly—there is no shell and no checkout path.

## Verification

Verify all of the following before leaving the daemon loaded:

- launchd reports `UserName = _floprefresh` and the root-owned binary path.
- binary and plist hashes match the reviewed release artifacts.
- service runtime contains no encrypted identity or unrelated file.
- a due run updates only the two approved notes and records a matching readback receipt.
- a one-byte change to origin, plan, target, or value causes zero network writes.
- the service cannot read the human identity vault or user home, spawn a process, read environment
  variables, or connect to another host/port.

## Rollback

Unload the LaunchDaemon first. Preserve public runtime state, then restore the prior reviewed binary
and plist or leave the service disabled. Identity storage is a separate transaction and must never
be deleted or moved as part of refresh rollback.
