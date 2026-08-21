# Updating Kanjiscribe

Updates are **Releases**: the dev build is promoted to the live **Instance** with one command. The release script (`scripts/release.sh`) is the primary path — it builds, stages, stops the service, copies the live data into staging, swaps the instance into place with two atomic renames, starts the service, and verifies the health endpoint, rolling back automatically if verification fails. A complete manual procedure is documented below as a fallback for when the script is unavailable or untrusted.

The paths below assume the layout from [deployment.md](deployment.md): dev repository at `/media/default/ssd/dev/kanjiscribe`, live instance at `/media/default/ssd/prod/kanjiscribe`. Adjust as needed.

## Releasing with the script (primary path)

```bash
cd /media/default/ssd/dev/kanjiscribe
./scripts/release.sh release /media/default/ssd/prod/kanjiscribe
```

The target is an explicit, required argument — there is no default, so a bare invocation can never accidentally release to production. The target must either already be an instance (containing `apps/api/dist/server.js` and `systemd/kanjiscribe.service`) or not exist at all (fresh install, below); the dev repository itself is refused as a target.

The release pipeline runs in this order:

1. **Build** — runs `scripts/build-prod.sh` (the same build the manual path uses). A failed build exits 3 before the target is modified in any way.
2. **Stage** — assembles a complete **Staging instance** at `<target>.staging`: the API bundle, the built frontend, the systemd unit, the docs, and the production-only native dependency (`better-sqlite3`) installed with npm inside staging. A stale staging directory from a crashed run aborts the release (exit 2); re-run with `--force` to remove it and proceed.
3. **Stop** — stops the systemd service so the data copy captures a clean, WAL-checkpointed database. A stop failure aborts the release (exit 4) before any data copy or swap.
4. **Copy data** — copies the live instance's `data/` into staging. The dev repository's `data/` is never a source for an update: the staging instance inherits the live instance's data, and migrations run against it at service boot exactly as they always have. If WAL sidecar files (`kanjiscribe.db-wal`, `kanjiscribe.db-shm`) survive the stop, they are copied too and a WARNING is printed — pending writes are never silently dropped.
5. **Swap** — the **Instance swap**: two atomic renames (ADR-0009). The live instance is renamed aside and becomes the **Release backup** `<target-basename>-release-<TS>` (the backup *is* the rename — no copy, and the live directory is never in a half-updated state); the staging instance renames into the live slot. An interruption can only ever leave the old or the new instance live, never a mixture.
6. **Start** — starts the service.
7. **Verify** — polls `http://localhost:<port>/health` every 2 seconds with a 30-second budget (HTTP 200 = success). On failure the script **auto-rolls back**: the broken instance is moved aside as a **Failed instance** (`<target-basename>-failed-<TS>`, kept for inspection) and the release backup is restored into the live slot, then the service is restarted. The release exits 6. With `--no-auto-rollback` the failed release stays live for inspection and the script prints the rollback command to run manually.

When run as root, the staged and swapped directories are chowned to the invoking user (`$SUDO_USER`, else the login name) so the service user retains access; a non-root run needs no chown. A failed chown is reported but does not fail the pipeline.

### Release flags

| Flag | Default | Effect |
|------|---------|--------|
| `--service NAME` | `kanjiscribe` | systemd service name to stop/start |
| `--health-port PORT` | `52654` | localhost port used for the `/health` check |
| `--skip-service` | off | skip all service management (stop, start, health polling) — use for instances without a systemd unit |
| `--no-build` | off | skip the build and stage the already-built artifacts from the dev repository |
| `--no-auto-rollback` | off | leave a failed release live for inspection instead of rolling back |
| `--force` | off | remove a stale staging directory and proceed |
| `--keep N` | `3` | keep the N most recent release backups (positive integer) |

The build script path can be overridden with the `KANJISCRIBE_BUILD_SCRIPT` environment variable (used by the test suite).

### Fresh install

When the target does not exist, `release` performs a fresh install: the backup, data-copy, and swap phases are skipped, and the assembled staging instance — carrying an empty `data/` skeleton — renames directly into place as the target. No release backup or failed-instance sibling is created. The target's parent directory must already exist (the script never creates parent directories; a missing parent exits 2). **Dataset import and service registration remain manual steps** — see the first-time setup steps in [deployment.md](deployment.md). A subsequent release onto the now-existing target behaves as a normal update again.

On a fresh install in service mode, the systemd unit must already be registered: if it is not, the start step fails and the release exits 6 after the install is in place (auto-rollback cannot help — there is no release backup yet). The initial install therefore uses `--skip-service` (see [deployment.md](deployment.md) Step 2), and service registration comes after.

## Rolling back with the script

```bash
./scripts/release.sh list /media/default/ssd/prod/kanjiscribe
./scripts/release.sh rollback /media/default/ssd/prod/kanjiscribe
./scripts/release.sh rollback /media/default/ssd/prod/kanjiscribe --backup 20260814-101530
```

- `list` prints the managed siblings newest first as `name<TAB>timestamp<TAB>kind` — release backups first (kind `release`; the timestamp column is the exact value to pass to `rollback --backup`), then failed instances (kind `failed`, for inspection only).
- `rollback` restores the newest release backup by default, or the one named by `--backup <TS>`. An unknown or invalid selector exits 7 and changes nothing.
- Rollback is always a **full instance restore** — code *and* data — via a rename swap: the current live instance moves aside as a new release backup and the chosen backup renames into the live slot. Study data recorded since the release is discarded.
- The `rollback` subcommand does not manage the service itself — only the automatic rollback after a failed verification restarts the service. After a scripted rollback, stop and start the service by hand (`sudo systemctl restart kanjiscribe`) so it runs the restored code.

## Naming and retention

Directories the script manages (all siblings of the live instance, same filesystem):

| Kind | Name | Retention |
|------|------|-----------|
| Release backup | `<target-basename>-release-<TS>` | the 3 newest are kept (`--keep N` overrides) |
| Staging instance | `<target>.staging` | removed on abort; consumed by the swap |
| Failed instance | `<target-basename>-failed-<TS>` | the 1 newest is kept |

`<TS>` is `YYYYmmdd-HHMMSS` (lexically sortable). Matching is anchored — a literal prefix plus a strictly numeric timestamp — so pruning only ever considers the script's own directories. Anything else sitting next to the live instance (for example a legacy manual-backup directory) is never listed, pruned, or overwritten. Pruning deletes whole backup directories.

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | usage error (missing/extra arguments, unknown flag) |
| 2 | guard failure (target not an instance, dev repository root, stale staging, missing parent of a fresh-install target, no release backups available for a selector-less rollback) |
| 3 | build failure |
| 4 | service stop failure |
| 5 | data copy failure |
| 6 | health verification failure / auto-rollback performed |
| 7 | rollback failure (unknown or invalid backup selector) |

Every failure class prints a clear `[error]` message to stderr and leaves the live instance untouched whenever the failure occurs before the swap.

## Manual release procedure (fallback)

Use this only when the script is unavailable or untrusted. Executed exactly as written, it produces the same end state the script produces: a live instance with the new code and the copied live data, the previous instance preserved as a timestamped release backup, no leftover staging directory, and the same 3-backup retention. `TS` values below must use the script's `YYYYmmdd-HHMMSS` format so the script can recognize the directories later.

```bash
cd /media/default/ssd/dev/kanjiscribe

# 1. Build (same build the script runs)
./scripts/build-prod.sh

# 2. Stop the service (clean WAL checkpoint before the data copy)
sudo systemctl stop kanjiscribe

# 3. Manual backup: rename the live instance aside. This rename IS the
#    release backup (same atomic move the script performs — never copy).
TS=$(date +%Y%m%d-%H%M%S)
mv /media/default/ssd/prod/kanjiscribe /media/default/ssd/prod/kanjiscribe-release-$TS

# 4. Assemble the new instance in a staging directory (same contents the
#    script stages)
STG=/media/default/ssd/prod/kanjiscribe.staging
mkdir -p "$STG/apps/api/dist" "$STG/apps/web/dist" "$STG/systemd" "$STG/docs" "$STG/data"
cp -a apps/api/dist/. "$STG/apps/api/dist/"
cp -a apps/web/dist/. "$STG/apps/web/dist/"
cp systemd/kanjiscribe.service "$STG/systemd/"
cp -a docs/. "$STG/docs/"
cat > "$STG/apps/api/package.json" <<'EOF'
{
  "name": "@kanjiscribe/api-prod",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "better-sqlite3": "^11.8.1"
  }
}
EOF
(cd "$STG/apps/api" && npm install --omit=dev --no-package-lock)

# 5. Copy the live data into staging. The data source is the instance you
#    just renamed aside — never the dev repository's data/ directory.
cp -a /media/default/ssd/prod/kanjiscribe-release-$TS/data/. "$STG/data/"
cp -a /media/default/ssd/prod/kanjiscribe-release-$TS/data/kanjiscribe.db-wal "$STG/data/" 2>/dev/null || true
cp -a /media/default/ssd/prod/kanjiscribe-release-$TS/data/kanjiscribe.db-shm "$STG/data/" 2>/dev/null || true

# 6. Swap: staging -> live (second atomic rename)
mv "$STG" /media/default/ssd/prod/kanjiscribe

# 7. Ownership: the script does this automatically when run as root
sudo chown -R default:default /media/default/ssd/prod/kanjiscribe \
    /media/default/ssd/prod/kanjiscribe-release-$TS

# 8. Start the service
sudo systemctl start kanjiscribe

# 9. Verify (the script polls every 2s for up to 30s; by hand, check status)
curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:52654/health
#    expect: 200
sudo journalctl -u kanjiscribe --since "1 minute ago"

# 10. Prune to the 3 newest release backups (names matching the script's
#     pattern only — foreign directories are never deleted)
find /media/default/ssd/prod -maxdepth 1 -type d -name 'kanjiscribe-release-*' \
    | grep -E 'kanjiscribe-release-[0-9]{8}-[0-9]{6}$' \
    | sort -r | tail -n +4 | xargs -r rm -rf
```

### Manual rollback

Restores a release backup wholesale — code and data, exactly like the script's rollback. Study data recorded since the release is discarded.

```bash
# 1. Stop the service
sudo systemctl stop kanjiscribe

# 2. Pick the backup to restore (newest by default)
BACKUP=/media/default/ssd/prod/kanjiscribe-release-<TS>

# 3. Move the live instance aside as a new release backup (mirrors the script)
NEWTS=$(date +%Y%m%d-%H%M%S)
mv /media/default/ssd/prod/kanjiscribe /media/default/ssd/prod/kanjiscribe-release-$NEWTS

# 4. Restore the chosen backup into the live slot
mv "$BACKUP" /media/default/ssd/prod/kanjiscribe

# 5. Ownership
sudo chown -R default:default /media/default/ssd/prod/kanjiscribe

# 6. Start and verify
sudo systemctl start kanjiscribe
curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:52654/health
```

### Manual rollback after a failed release

If a manual release fails verification, this reproduces the script's auto-rollback: the broken instance is moved aside as a Failed instance for inspection and the pre-release backup is restored.

```bash
sudo systemctl stop kanjiscribe
FAILTS=$(date +%Y%m%d-%H%M%S)
mv /media/default/ssd/prod/kanjiscribe /media/default/ssd/prod/kanjiscribe-failed-$FAILTS
mv /media/default/ssd/prod/kanjiscribe-release-<newest-TS> /media/default/ssd/prod/kanjiscribe
sudo systemctl start kanjiscribe
curl --silent --output /dev/null --write-out '%{http_code}' http://localhost:52654/health
# keep only the newest failed instance, mirroring the script's retention:
find /media/default/ssd/prod -maxdepth 1 -type d -name 'kanjiscribe-failed-*' \
    | grep -E 'kanjiscribe-failed-[0-9]{8}-[0-9]{6}$' \
    | sort -r | tail -n +2 | xargs -r rm -rf
```

## Notes

- **Migrations**: The API server runs migrations automatically on every boot (`CREATE TABLE IF NOT EXISTS` style). You do not need to run `pnpm --filter @kanjiscribe/api db:migrate` manually — the server handles it, against the live instance's data.
- **Import data updates**: If upstream datasets (JMdict, KANJIDIC2, KanjiVG) have been updated and you want to refresh, re-run the importer commands. This is safe because imports use `INSERT OR REPLACE` / upsert semantics — existing study data and assignments are preserved.
- **WAL checkpointing**: On shutdown the server runs `PRAGMA wal_checkpoint(TRUNCATE)` to flush the write-ahead log and remove the `-wal` and `-shm` files from the data directory. This keeps the database clean — and is why the release pipeline copies the live data only after the service has stopped.
- **Data directory**: An update copies the live instance's data into the staging instance; the dev repository's `data/` is never a source for updates, and migrations run against the live data at service boot. The dev repository's data participates only in the documented first-time dataset import, never in a release.
- **Logs**: Systemd captures all output. View live logs with `sudo journalctl -u kanjiscribe -f`.
- **Restart policy**: The service uses `Restart=always` with a 5-second delay. If the process crashes, systemd will restart it automatically.
