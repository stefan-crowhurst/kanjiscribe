# Deployment Guide

This document covers installing Kanjiscribe as a production systemd service on a Raspberry Pi.

## Architecture

The API server is bundled with `esbuild` into a single `dist/server.js` file (~1.8MB). At runtime, the only `node_modules` dependency needed is `better-sqlite3` (the native SQLite addon) — everything else is inlined into the bundle.

A release stages a complete instance from the dev build and swaps it into place with two atomic renames (ADR-0009); see [updating.md](updating.md) and the instance layout below.

## Prerequisites

- Raspberry Pi running a Debian-based OS (Raspberry Pi OS, Ubuntu, etc.)
- Node.js 22+ and pnpm (install globally with `corepack enable`)
- Build tools for native addons: `sudo apt install build-essential python3`
- Access to the Pi via Tailscale (or SSH on local network)
- JMdict, KANJIDIC2, and KanjiVG dataset files (see [README.md](../README.md) for download links)

## Important: Build on the Pi

`better-sqlite3` is a native C++ addon compiled during `pnpm install`. It must be built on the same architecture it runs on. Your Raspberry Pi is ARM64; if you build on an x86 machine the binary will not load. Clone and build directly on the Pi.

## Directory Layout

This guide assumes:
- **Dev / build source**: `/media/default/ssd/dev/kanjiscribe`
- **Production target (the live instance)**: `/media/default/ssd/prod/kanjiscribe`
- **Data** (database + SVGs): `/media/default/ssd/prod/kanjiscribe/data`
- **Service user**: `default` (the default Pi user)

Adjust paths and user if yours differ.

## Step 1: Build in Dev

```bash
cd /media/default/ssd/dev/kanjiscribe
./scripts/build-prod.sh
```

This:
1. Installs dependencies
2. Builds the shared package
3. Builds the web frontend (with `VITE_API_BASE=http://raspberrypi:$KANJISCRIBE_API_PORT` — API calls go to the Pi's Tailscale host name, not a relative path)
4. Bundles the API with `esbuild` into `apps/api/dist/server.js`
5. Copies SQL migration files into `apps/api/dist/db/sql/`

The release script runs this build itself by default, so on a normal release this step is optional — run it manually only for the manual update path (see [updating.md](updating.md)).

## Step 2: Install the Instance

```bash
cd /media/default/ssd/dev/kanjiscribe
./scripts/release.sh release /media/default/ssd/prod/kanjiscribe --skip-service
```

Use `--skip-service` for this first install: the systemd unit is not registered until Step 5, and in service mode the release would start the (not-yet-registered) service, fail its health verification, and exit 6 after the install is in place. Later releases onto this target use service mode normally.

With the target not yet existing, the release script performs a **fresh install**: it assembles a complete instance at a staging directory and renames it into place. The instance contains everything the runtime needs:

- `apps/api/dist/server.js` — the bundled API server (~1.8MB, all JS deps inlined)
- `apps/api/dist/db/sql/` — database migrations
- `apps/api/package.json` + `apps/api/node_modules/` — installed by `npm install` inside staging; contains `better-sqlite3` and its ~15 transitive dependencies (the only node_modules needed at runtime)
- `apps/web/dist/` — the built frontend
- `systemd/kanjiscribe.service` — the systemd service file
- `docs/` — operator guides (this deployment guide and the updating guide)
- `data/` — an empty skeleton; **dataset import stays manual** (Step 6)

The target's parent directory must already exist — the release script never creates parent directories. On a fresh install no release backup is created (there was no previous instance); later releases onto the existing target back up and swap as normal. See [updating.md](updating.md) for the full release pipeline, retention rules, and rollback.

## Step 3: Copy Your Data (First-time Setup Only)

This step is **first-time setup only** — it brings existing data into the fresh instance once. The dev repository's `data/` is never a source for updates: every update copies the live instance's own data into the new instance instead (see [updating.md](updating.md)).

If you have an existing database and KanjiVG SVG files from development:

```bash
mkdir -p /media/default/ssd/prod/kanjiscribe/data
cp /media/default/ssd/dev/kanjiscribe/data/kanjiscribe.db /media/default/ssd/prod/kanjiscribe/data/
cp /media/default/ssd/dev/kanjiscribe/data/kanjiscribe.db-wal /media/default/ssd/prod/kanjiscribe/data/
cp /media/default/ssd/dev/kanjiscribe/data/kanjiscribe.db-shm /media/default/ssd/prod/kanjiscribe/data/
cp -r /media/default/ssd/dev/kanjiscribe/data/kanji-svg /media/default/ssd/prod/kanjiscribe/data/
sudo chown -R default:default /media/default/ssd/prod/kanjiscribe/data
```

**Tip**: Stop the dev server first (Ctrl+C) to trigger the graceful shutdown WAL checkpoint. This flushes all pending writes to the main `.db` file, so you only need to copy that single file.

If setting up fresh, skip this step and import the datasets (Step 6) — the release script's fresh install has already created the `data/` directory.

## Step 4: Review the systemd Service

```bash
cat /media/default/ssd/prod/kanjiscribe/systemd/kanjiscribe.service
```

Key settings:
| Setting | Value |
|---------|-------|
| `User` / `Group` | `default` (default) |
| `WorkingDirectory` | `/media/default/ssd/prod/kanjiscribe` |
| `KANJISCRIBE_DATA_DIR` | `/media/default/ssd/prod/kanjiscribe/data` |
| `KANJISCRIBE_API_PORT` | `52654` |
| `KANJISCRIBE_API_HOST` | `0.0.0.0` |

## Step 5: Install and Start the Service

```bash
sudo cp /media/default/ssd/prod/kanjiscribe/systemd/kanjiscribe.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable kanjiscribe
sudo systemctl start kanjiscribe
```

## Step 6: Import Reference Data (First-time Setup)

If this is a fresh install without existing data, import the dictionary datasets:

```bash
cd /media/default/ssd/dev/kanjiscribe
KANJISCRIBE_DATA_DIR=/media/default/ssd/prod/kanjiscribe/data \
  pnpm --filter @kanjiscribe/importer dev import:kanjidic2 /path/to/kanjidic2.xml.gz

KANJISCRIBE_DATA_DIR=/media/default/ssd/prod/kanjiscribe/data \
  pnpm --filter @kanjiscribe/importer dev import:jmdict /path/to/JMdict_e.gz

KANJISCRIBE_DATA_DIR=/media/default/ssd/prod/kanjiscribe/data \
  pnpm --filter @kanjiscribe/importer dev import:kanjivg /path/to/kanjivg-release.zip 2026-03
```

## Step 7: Verify

```bash
# Check service status
sudo systemctl status kanjiscribe

# View logs
sudo journalctl -u kanjiscribe -f

# Test the health endpoint
curl http://localhost:52654/health

# Load the web app (from a browser on the Tailscale network)
# http://<pi-tailscale-ip>:52654
```

## What Gets Installed

The production directory contains only what's needed at runtime:

```
/media/default/ssd/prod/kanjiscribe/
├── apps/
│   ├── api/
│   │   ├── dist/
│   │   │   ├── server.js       # Bundled API (~1.8MB, all JS deps inlined)
│   │   │   └── db/sql/         # Migration files
│   │   └── node_modules/       # Installed by npm in target
│   │       ├── better-sqlite3/ # Native addon
│   │       ├── bindings/       # Transitive dependency
│   │       └── ...             # (~15 packages total)
│   └── web/
│       └── dist/               # Built frontend
├── systemd/
│   └── kanjiscribe.service     # systemd unit file
├── docs/                       # Operator guides (deployment + updating)
└── data/                       # Your database + kanji-svg/
```

No other `node_modules` are needed in production.

## Instance Layout and Release Siblings

The live instance is one directory among several that the release script manages in the same parent:

```
/media/default/ssd/prod/
├── kanjiscribe/                                  # live instance (the target)
├── kanjiscribe-release-20260814-101530/          # release backup (newest)
├── kanjiscribe-release-20260807-091512/          # release backup
├── kanjiscribe-release-20260801-084421/          # release backup (oldest kept)
├── kanjiscribe-failed-20260810-152233/           # failed instance (if any)
└── kanjiscribe.staging/                          # staging instance (only mid-release)
```

- **Release backup** — `kanjiscribe-release-<TS>`: the pre-release live instance, renamed aside by the swap (the backup *is* the rename — never a copy). A full instance: code, data, systemd unit, docs. Rollback restores from it.
- **Staging instance** — `kanjiscribe.staging`: the complete new instance assembled before the swap. Normally exists only for the seconds a release is running; a leftover from a crashed run aborts the next release until removed with `--force`.
- **Failed instance** — `kanjiscribe-failed-<TS>`: an instance that failed health verification and was swapped back out, kept whole for inspection.

Naming, the `<TS>` timestamp format, retention (3 newest release backups, 1 newest failed instance, `--keep N` override), and the anchored-matching discipline are specified in [updating.md](updating.md) — the script only ever prunes or swaps directories it recognizes, and any other directory in the parent is never listed, pruned, or overwritten.

### Rollback

```bash
./scripts/release.sh list /media/default/ssd/prod/kanjiscribe    # see available backups
./scripts/release.sh rollback /media/default/ssd/prod/kanjiscribe # restore the newest
```

Rollback is always a **full instance restore** — code and data — performed as a rename swap: the current live instance moves aside as a new release backup, and the chosen backup renames into the live slot. Study data recorded since the release is discarded. See [updating.md](updating.md) for the complete rollback flow and exit codes.

### Legacy backup directory

A single-slot backup directory (e.g. `kanjiscribe-manual-backup`) may sit next to the live instance from before this scheme existed. Its name does not match the script's patterns, so the script ignores it completely — it is never listed, pruned, or rolled back to. Once you trust the new rotation (a few successful releases with rollbacks tested), remove it by hand to reclaim the disk space.

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `KANJISCRIBE_API_PORT` | `52654` | Port the API/web server listens on |
| `KANJISCRIBE_API_HOST` | `0.0.0.0` | Address to bind to |
| `KANJISCRIBE_DATA_DIR` | `data/` relative to repo root | Sets both DB path and SVG dir at once |
| `KANJISCRIBE_DB_PATH` | `$DATA_DIR/kanjiscribe.db` | Override for database file path |
| `KANJI_SVG_DIR` | `$DATA_DIR/kanji-svg` | Override for KanjiVG SVG directory |

## Security Notes

- The service binds to `0.0.0.0`, which makes it accessible on all network interfaces. Since the Pi is on a Tailscale network, only Tailscale-connected devices can reach it.
- For additional security, you could set `KANJISCRIBE_API_HOST` to the Pi's Tailscale IP instead of `0.0.0.0`.
- The systemd service uses `NoNewPrivileges=true` and restricts address families to only TCP/IP and UNIX sockets.
- No authentication is built in; this is a single-user app designed for a private Tailscale network.

## Migrating from Development (First-time Setup Only)

If you've been using the app in development and want to keep the same database in production, this one-time import brings the dev data into the fresh instance. This is the **only** time the dev repository's `data/` is a data source — updates never touch it (they copy the live instance's data; see [updating.md](updating.md)).

**Option A — Clean shutdown (recommended):**
Stop the dev server with Ctrl+C. This triggers `PRAGMA wal_checkpoint(TRUNCATE)`, which flushes all pending writes and removes the `-wal`/`-shm` files. Then copy just the `.db` file:

```bash
cp /media/default/ssd/dev/kanjiscribe/data/kanjiscribe.db /media/default/ssd/prod/kanjiscribe/data/
```

**Option B — Unclean shutdown:**
If the dev server stopped unexpectedly (power loss, kill -9), copy all three database files to avoid losing recent writes:

```bash
cp /media/default/ssd/dev/kanjiscribe/data/kanjiscribe.db* /media/default/ssd/prod/kanjiscribe/data/
```

Also copy the KanjiVG SVG files:

```bash
cp -r /media/default/ssd/dev/kanjiscribe/data/kanji-svg /media/default/ssd/prod/kanjiscribe/data/
```

When the production server starts, it will open the existing `.db` and create fresh `-wal`/`-shm` files automatically.
