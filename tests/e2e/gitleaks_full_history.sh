#!/usr/bin/env bash
set -euo pipefail

repository_root="${1:?repository root is required}"
gitleaks_config="${repository_root}/.gitleaks.toml"
fixture_root="$(mktemp -d "${TMPDIR:-/tmp}/flop-gitleaks-history.XXXXXX")"

cleanup() {
  rm -rf -- "${fixture_root}"
}
trap cleanup EXIT

git -C "${fixture_root}" init -q -b main
git -C "${fixture_root}" config user.email "fixture@example.invalid"
git -C "${fixture_root}" config user.name "Gitleaks Fixture"

mkdir -p "${fixture_root}/tests/unit"
did_prefix="z6Mkv1o2GEgtXjFdEMfLtupc"
did_suffix="KhGRydM8V7VHzii7Uh4aHoqH"
printf 'const did = "did:key:%s%s";\n' "${did_prefix}" "${did_suffix}" \
  > "${fixture_root}/tests/unit/protocol_test.ts"
git -C "${fixture_root}" add tests/unit/protocol_test.ts
git -C "${fixture_root}" commit -q -m "add public DID fixture"

gitleaks git --config "${gitleaks_config}" --log-opts="--all" --redact=100 --no-banner \
  "${fixture_root}"

git -C "${fixture_root}" switch -q -c non-first-parent
distinct_prefix="123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
distinct_suffix="abcdefghijkmnopqrstuvwxyz"
printf 'const candidate = "did:key:z%s%s";\n' "${distinct_prefix}" "${distinct_suffix}" \
  > "${fixture_root}/tests/unit/distinct_test.ts"
git -C "${fixture_root}" add tests/unit/distinct_test.ts
git -C "${fixture_root}" commit -q -m "add non-allowlisted key fixture"

git -C "${fixture_root}" switch -q main
printf 'safe\n' > "${fixture_root}/safe.txt"
git -C "${fixture_root}" add safe.txt
git -C "${fixture_root}" commit -q -m "advance first parent"
git -C "${fixture_root}" merge --no-ff -q non-first-parent -m "merge fixture branch"
git -C "${fixture_root}" rm -q tests/unit/distinct_test.ts
git -C "${fixture_root}" commit -q -m "remove key from current tree"

set +e
gitleaks git --config "${gitleaks_config}" --log-opts="--all" --exit-code=42 --redact=100 \
  --no-banner "${fixture_root}" > /dev/null 2>&1
scan_status=$?
set -e

if [[ "${scan_status}" -ne 42 ]]; then
  printf 'expected non-first-parent detection status 42, got %s\n' "${scan_status}" >&2
  exit 1
fi
