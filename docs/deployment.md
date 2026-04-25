# Deployment Guide

This document covers deploying Kanjiscribe as a production systemd service on a Raspberry Pi.

## Architecture

The API server is bundled with `esbuild` into a single `dist/server.js` file (~1.8MB). At runtime, the only `node_modules` dependency needed is `better-sqlite3` (the native SQLite addon) — everything else is inlined into the bundle.

The deployment copies built artifacts from your dev directory to a production directory.

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
- **Production deploy target**: `/media/default/ssd/prod/kanjiscribe`
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
3. Builds the web frontend (with `VITE_API_BASE=""` for same-origin API calls)
4. Bundles the API with `esbuild` into `apps/api/dist/server.js`
5. Copies SQL migration files into `apps/api/dist/db/sql/`

## Step 2: Deploy to Production

```bash
cd /media/default/ssd/dev/kanjiscribe
./scripts/deploy.sh /media/default/ssd/prod/kanjiscribe
```

This copies the minimal runtime files:
- `apps/api/dist/server.js` — the bundled API server (~1.8MB, all JS deps inlined)
- `apps/api/dist/db/sql/` — database migrations
- `apps/web/dist/` — the built frontend
- `apps/api/node_modules/` — installed by `npm install` in the target; contains `better-sqlite3` and its ~15 transitive dependencies (the only node_modules needed at runtime)
- `systemd/kanjiscribe.service` — the systemd service file
- `docs/` — deployment and update documentation

## Step 3: Copy Your Data

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

If setting up fresh, create the data directory and import the datasets (see Step 6).

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

## What Gets Deployed

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
├── docs/                       # Deployment docs
└── data/                       # Your database + kanji-svg/
```

No other `node_modules` are needed in production.

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

## Migrating from Development

If you've been using the app in development and want to keep the same database in production:

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
