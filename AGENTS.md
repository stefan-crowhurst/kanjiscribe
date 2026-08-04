## Subagents

- **vision**: A vision-capable subagent (`@vision` or via the task tool) that looks at images, screenshots, mockups, diagrams, and charts and reports their contents. Delegate to it whenever the user references an image or you need to know what is in one but the active model cannot see attachments — relay its report back to the user rather than guessing.

  **Limitation — subagents never receive parent-session attachments.** The task tool forwards only the text prompt to a subagent, and a pasted/attached image is stored as an inline data URL (no filesystem path). So `@vision` can only see an image that exists as a real file on disk. When delegation is needed: if the user gave you a path, or the image is a real file in the worktree, delegate to `vision` telling it the exact file path. If the image was pasted/attached with no accessible path, do not guess or claim you read it — tell the user the subagent needs a real file path (e.g. ask them to save the image and share its path).

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/` (no remote-tracker dependency). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map 1:1 to their names (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.