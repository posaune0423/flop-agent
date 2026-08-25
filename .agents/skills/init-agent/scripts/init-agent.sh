#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT"

err() {
  echo "init-agent: $*" >&2
  exit 1
}

for sub in skills commands rules; do
  [[ -d ".agents/${sub}" ]] || err "missing source directory: .agents/${sub}"
done

for parent in .cursor .claude .codex; do
  mkdir -p "$parent"
  for sub in skills commands rules; do
    dest="${parent}/${sub}"
    target="../.agents/${sub}"
    if [[ -L "$dest" ]]; then
      [[ "$(readlink "$dest")" == "$target" ]] || err "unexpected symlink: ${dest}"
    elif [[ -e "$dest" ]]; then
      err "${dest} exists and is not a symlink"
    else
      ln -s "$target" "$dest"
    fi
  done
done

if [[ -L CLAUDE.md ]]; then
  [[ "$(readlink CLAUDE.md)" == "AGENTS.md" ]] || err "unexpected CLAUDE.md symlink"
elif [[ -e CLAUDE.md ]]; then
  err "CLAUDE.md exists and is not a symlink"
else
  ln -s AGENTS.md CLAUDE.md
fi

echo "init-agent: done (cwd: ${ROOT})"
