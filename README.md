# kanjiscribe

Private companion app for drilling difficult Japanese words from Anki workflows.

## Stack

- `apps/api`: Fastify + SQLite
- `apps/web`: React + Vite
- `packages/shared`: shared `zod` schemas and enums
- `packages/importer`: JMdict / KANJIDIC2 / KanjiVG importer CLI

## Quick Start

```bash
pnpm install
pnpm --filter @kanjiscribe/api db:migrate
pnpm dev
```

API runs on `http://localhost:3000` and web runs on `http://localhost:5173`.

## Native Dependency Build Approval

This workspace uses pnpm build approvals. `better-sqlite3` is pre-approved in `pnpm-workspace.yaml`, so new checkouts should be able to run `pnpm install` without manually running `pnpm approve-builds`.

If you still see native binding errors on a fresh machine:

```bash
pnpm approve-builds
pnpm install --force
```

Also commit `pnpm-lock.yaml` to keep native dependency versions consistent across environments.

## Importer

```bash
pnpm --filter @kanjiscribe/importer dev import:kanjidic2 /path/to/kanjidic2.xml.gz
pnpm --filter @kanjiscribe/importer dev import:jmdict /path/to/JMdict_e.gz
pnpm --filter @kanjiscribe/importer dev import:kanjivg /path/to/kanjivg-release.zip 2026-03
```

Environment variables:

- `DB_PATH` (default: `data/kanjiscribe.db`)
- `KANJI_SVG_DIR` (default: `data/kanji-svg`)

## Implemented MVP Flows

- dictionary search and entry lookup
- manual intake with study item reuse and assignment creation
- today and backlog assignment views
- drill screen with timer, complete, and skip
- dashboard metrics and heatmap backing data
- settings page with required dataset attribution
