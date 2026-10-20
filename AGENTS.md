## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/` (no remote-tracker dependency). See `docs/agents/issue-tracker.md`.

### Triage status strings

Five canonical roles map 1:1 to their names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## House rules

Do not take state-changing git actions (`add`, `commit`, `push`, branch, checkout, merge, rebase, reset, `stash`, `worktree`, `config`) on your own initiative. Leave the work uncommitted in the working tree and hand back for the human to review, commit, and push. Read-only git (`status`, `diff`, `log`, `show`) is fine when you need to inspect. When the user or a skill's documented procedure explicitly asks for git operations, run exactly those and no more.

Use British English in prose and comments, and in identifiers you coin (`colourFor`). Identifiers that extend an established family keep that family's spelling (`colorFor` beside `getColor`), since that is conformity, not a free decision. Never rewrite existing names or untouched prose mid-task; flag spelling inconsistencies at hand-back so they can be fixed in a separate commit.