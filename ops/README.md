# Root-owned guarded refresh installation

[日本語](README-ja.md)

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

## Schedule semantics

The plist offers four calendar runs at 00:43, 06:43, 12:43, and 18:43. The binary still enforces its
five-day receipt gate, so ordinary runs stop before network I/O. If a due run fails before a
verified receipt is saved, the next six-hour slot can retry without weakening the fixed origin,
plan, target, or value policy.

`StartCalendarInterval` coalesces missed sleep-time slots into one run when macOS wakes. It does not
provide execution while the host is shut down. `KeepAlive` is deliberately absent because this is a
short-lived job, and `RunAtLoad` is omitted in favor of one explicit post-install kickstart.

## Human activation

After installing and hashing the exact reviewed files from a non-agent administrator terminal:

```sh
sudo launchctl bootstrap system \
  /Library/LaunchDaemons/io.github.posaune0423.flop-agent.refresh.plist
if ! service_before="$(sudo launchctl print system/io.github.posaune0423.flop-agent.refresh)"; then
  echo "could not inspect the loaded service" >&2
  exit 1
fi
if printf '%s\n' "${service_before}" | /usr/bin/grep -q 'state = running'; then
  echo "guarded refresh is already running; do not overlap activations" >&2
  exit 1
fi
log_size() {
  if sudo test -e "$1"; then
    sudo stat -f %z "$1"
  elif sudo test ! -e "$1"; then
    printf '0'
  else
    echo "could not establish log existence: $1" >&2
    return 1
  fi
}
stdout_path=/var/db/flop-agent-refresh/runtime/stdout.log
stderr_path=/var/db/flop-agent-refresh/runtime/stderr.log
if ! stdout_size="$(log_size "${stdout_path}")"; then exit 1; fi
if ! stderr_size="$(log_size "${stderr_path}")"; then exit 1; fi
case "${stdout_size}:${stderr_size}" in
  *[!0-9:]*) echo "invalid pre-run log size" >&2; exit 1 ;;
esac
if ! service_pid="$(sudo launchctl kickstart -p system/io.github.posaune0423.flop-agent.refresh)"; then
  echo "launchctl kickstart failed" >&2
  exit 1
fi
case "${service_pid}" in
  ''|*[!0-9]*) echo "launchctl returned an invalid PID" >&2; exit 1 ;;
esac
attempts=0
while sudo kill -0 "${service_pid}" 2>/dev/null; do
  attempts=$((attempts + 1))
  if [ "${attempts}" -ge 180 ]; then
    echo "guarded refresh did not exit within 180 seconds" >&2
    exit 1
  fi
  sleep 1
done
if ! stdout_delta="$(sudo tail -c "+$((stdout_size + 1))" "${stdout_path}")"; then
  echo "could not read current stdout" >&2
  exit 1
fi
if ! current_stderr_size="$(sudo stat -f %z "${stderr_path}" 2>/dev/null)"; then
  echo "could not stat current stderr" >&2
  exit 1
fi
case "${current_stderr_size}" in
  ''|*[!0-9]*) echo "invalid current stderr size" >&2; exit 1 ;;
esac
if [ "${current_stderr_size}" -ne "${stderr_size}" ]; then
  echo "current activation wrote to stderr" >&2
  sudo tail -c "+$((stderr_size + 1))" "${stderr_path}" >&2
  exit 1
fi
if ! status="$(printf '%s\n' "${stdout_delta}" | /usr/bin/plutil -extract status raw -o - - 2>/dev/null)"; then
  echo "current stdout is not one valid result JSON object" >&2
  exit 1
fi
case "${status}" in
  refreshed|skipped) ;;
  *) echo "unexpected guarded refresh status: ${status}" >&2; exit 1 ;;
esac
sudo launchctl print system/io.github.posaune0423.flop-agent.refresh
printf '%s\n' "${stdout_delta}"
```

Do not run these commands from Codex. Do not rely on the calendar slots until the kicked process has
exited, `launchctl print` reports a successful last exit, the JSON emitted by this activation has
`status` equal to `refreshed` or `skipped`, and this activation wrote nothing to stderr. A
`refreshed` result must also have its matching receipt and readback verified.

## Verification

Verify all of the following before leaving the daemon loaded:

- launchd reports `UserName = _floprefresh` and the root-owned binary path.
- launchd reports the four expected calendar intervals and no `KeepAlive` or `RunAtLoad` key.
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
