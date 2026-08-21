# Atomic instance swap for releases

## Context

The release pipeline used an in-place `deploy.sh` that `cp -r`-copied build artifacts over the live instance directory. An interruption mid-copy left a half-deployed instance — a mixture of old and new files — and the only backup discipline was a single ad-hoc database copy. A release needed to be atomic (either the old instance or the new one is live, never a mixture) and to preserve the pre-release instance for rollback.

## Decision

A release assembles a complete **staging instance** at a sibling path, then takes effect via two atomic renames on the same filesystem: live → timestamped release backup, staging → live. The release backup is created by the rename itself — there is no copy phase between live and backup — and rollback is literally renaming back. Staging assembly happens before any rename, so a failure while assembling leaves the live instance untouched.

## Considered Options

- **A. In-place copy (the old deploy.sh, rejected).** `cp -r` of artifacts over the live directory. Simple, but a mid-copy interruption leaves a half-deployed mixture, and there is no natural rollback artifact.
- **B. Copy, then swap (rejected).** Build the new instance at the staging path by copying, then rename it over the live slot after moving the old one aside. Atomic, but doubling the copy work: the pre-release instance would be copied to the backup *and* the new instance copied to staging.
- **C. Copy into staging, rename-based swap (chosen).** One copy phase only (into staging, including the live instance's data snapshot). The two renames are O(1) and atomic; interruption at any point leaves either the old or the new instance intact at the live path.

## Consequences

- The full data directory (~119MB: SQLite db + kanji-svg) is copied into staging on every release while the service is stopped.
- Rollback is always a full instance restore — study data recorded since a release is discarded when rolling back.
- Staging and the live target must share a filesystem (renames are not atomic across filesystems); the staging path is a fixed sibling of the target, which guarantees this.
- There is never a half-deployed live directory, and a stale staging directory from a crashed run is detectable and removable rather than silently reused.
