---
name: init-agent
description: Bootstrap one canonical .agents tree into Cursor, Claude, and Codex project folders.
---

# init-agent

From the repository root, run:

```bash
bash .agents/skills/init-agent/scripts/init-agent.sh
```

The script links `.agents/{skills,commands,rules}` into `.cursor`, `.claude`, and `.codex`, and
creates `CLAUDE.md` as a symlink to `AGENTS.md`. It refuses to replace non-symlink targets.
