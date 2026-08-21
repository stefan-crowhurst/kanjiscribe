#!/bin/bash
# KanjiScribe release tool — release, roll back, and list release backups.
#
# Implements the filesystem core of a release (ADR-0009: atomic instance swap):
#   1. build      run the build script (default) or stage prebuilt artifacts
#   2. stage      assemble a complete instance at <target>.staging
#   3. copy       copy the live instance's data/ into staging
#   4. swap       two atomic renames: live -> <target>-release-<TS>, staging -> live
#
# Service mode is the default. --skip-service leaves the filesystem-only path
# available for sandbox releases:
#   - Service control stops before the data copy, starts after the swap,
#     and verifies /health before the release is declared successful.
#   - Build integration (issue 04): a plain release invokes
#     scripts/build-prod.sh — the same build the manual documented path uses —
#     before staging anything, keeping one shared build procedure. The script
#     path can be overridden with the KANJISCRIBE_BUILD_SCRIPT environment
#     variable (a documented test seam; the tests point it at a stub). A
#     failed build exits EXIT_BUILD (3) before the target is modified in any
#     way: no staging directory, no renames, the live instance untouched.
#     --no-build skips the build and stages the dev repository's prebuilt
#     artifacts instead.
#   - Ownership (issue 04): when the script runs as root, the staged and
#     swapped directories are chowned to the invoking user — $SUDO_USER, else
#     the login name (logname) — so the service user retains access. When
#     neither can be determined the chown is skipped
#     with a warning rather than guessed. When not root, no chown is
#     performed. A failed chown is reported but does not fail the pipeline
#     (best-effort).
#   - Fresh install (issue 05): when the target directory does not exist,
#     release performs a fresh install — the nonexistence is what makes the
#     target valid, not a guard failure. The backup, data-copy, and swap
#     phases are skipped; the assembled staging instance (carrying an empty
#     data/ skeleton — dataset import remains a manual documented step) is
#     renamed directly into place as the target, so no release backup and no
#     failed-instance sibling is ever created and retention has nothing to
#     prune. The target's parent directory must already exist — the rename
#     needs it — and the script never creates parent directories (a missing
#     parent exits EXIT_GUARD). The build still runs by default (a fresh
#     instance needs artifacts) and --no-build is honored; ownership is
#     applied to the fresh target after the rename. A subsequent release onto
#     the now-existing target behaves as a normal update again.
#   - Retention and backup selectors (issue 02): after each successful swap the
#     release backups are pruned to the N most recent (default 3, overridable
#     with --keep N); deletion removes the whole backup directory, and the
#     newest backup is never deleted. rollback accepts --backup <TS> to restore
#     a specific retained backup; unknown or invalid selectors exit with
#     EXIT_ROLLBACK (7) and change nothing.
#
# ---------------------------------------------------------------------------
# Canonical exit-code table (all slices — use exactly these numbers):
#   1 EXIT_USAGE     usage error (missing/extra args)
#   2 EXIT_GUARD     guard failure (missing target, non-instance target,
#                    dev repository root, stale staging, missing parent of a
#                    fresh-install target)
#   3 EXIT_BUILD     build failure (the build script exited non-zero, or
#                    reported success without producing artifacts)
#   4 EXIT_STOP      service stop failure
#   5 EXIT_DATA_COPY data copy failure
#   6 EXIT_VERIFY    health verification failure / auto-rollback performed
#   7 EXIT_ROLLBACK  rollback failure (unknown or invalid backup selector)
# Staging-assembly and swap failures surface as guard-class (2); build failures
# surface as EXIT_BUILD (3). "No release
# backups available" for rollback without a selector surfaces as guard-class
# (2); a selector that does not name an existing release backup exits
# EXIT_ROLLBACK (7) and changes nothing.
#
# ---------------------------------------------------------------------------
# Directory naming patterns (STRICT — later slices depend on these, and
# foreign directories must never match):
#   release backup : <target-basename>-release-<TS>   e.g. kanjiscribe-release-20260814-101530
#   failed instance: <target-basename>-failed-<TS>
#   staging        : <target>.staging                 e.g. /x/kanjiscribe.staging
#   TS format      : YYYYmmdd-HHMMSS (lexically sortable)
# Pattern matching is anchored: ^<name>-release-[0-9]{8}-[0-9]{6}$ — a legacy
# directory like kanjiscribe-manual-backup never matches and is never touched.
#
# The dev repository's data/ directory is NEVER a source for an update: the
# staging instance inherits the live instance's data via the data copy, and
# migrations run against it at service boot exactly as they do today.
# ---------------------------------------------------------------------------

set -u
# Deliberately no `set -e`: every command that matters is followed by an
# explicit exit-code check mapped to the canonical exit-code table above, so
# each failure is reported with its class instead of the shell's generic 1.

# Canonical exit codes (see table above).
EXIT_USAGE=1
EXIT_GUARD=2
EXIT_BUILD=3
EXIT_STOP=4
EXIT_DATA_COPY=5
EXIT_VERIFY=6
EXIT_ROLLBACK=7

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT_REAL="$(realpath -e "$REPO_ROOT")"

# Build script for the default build mode: the separate scripts/build-prod.sh
# (the same build the manual documented path uses). KANJISCRIBE_BUILD_SCRIPT
# overrides the path — a documented test seam so the suite can stub the build.
BUILD_SCRIPT="${KANJISCRIBE_BUILD_SCRIPT:-$REPO_ROOT/scripts/build-prod.sh}"

# Ownership state (issue 04). INVOKING_USER is the user staged and swapped
# directories are chowned to when the script runs as root ("" = unresolved or
# unknown); OWNERSHIP_RESOLVED marks the one-time resolution as done.
INVOKING_USER=""
OWNERSHIP_RESOLVED=0

# Path of the staging instance currently being assembled ("" when none).
# The EXIT trap removes it unless the swap consumed it.
STAGING=""

err() {
    printf '[error] %s\n' "$*" >&2
}

cleanup_on_exit() {
    if [ -n "$STAGING" ] && [ -e "$STAGING" ]; then
        echo "[cleanup] removing staging directory: $STAGING" >&2
        rm -rf -- "$STAGING"
    fi
}
trap cleanup_on_exit EXIT

usage() {
    cat <<'EOF'
KanjiScribe release tool — release, roll back, and list release backups.

Usage:
   release.sh release  <target> [--service NAME] [--health-port PORT]
                         [--skip-service] [--no-build] [--no-auto-rollback]
                         [--force] [--keep N]
  release.sh rollback <target> [--backup <TS>]
  release.sh list     <target>
  release.sh help

Subcommands:
  release   Build (unless --no-build), assemble a complete new instance at
            <target>.staging, copy the live instance's data into it, then
            take effect with two atomic renames (ADR-0009): live ->
            <target>-release-<TS>, staging -> live. After the swap, release
            backups are pruned to the N most recent. When <target> does not
            exist yet, a fresh install is performed instead (see below).
  rollback  Restore a release backup into the live slot via a rename swap.
            Always a full instance restore — code and data. Defaults to the
            newest backup; --backup <TS> restores a specific one.
  list      Print the managed siblings of <target>, newest first, as
            name<TAB>timestamp<TAB>kind — release backups first (kind
            'release', the values 'rollback --backup' accepts), then failed
            instances (kind 'failed', for inspection only).

Flags (release only):
   --service NAME   systemd service name (default: kanjiscribe).
   --health-port N  localhost port used for the /health check (default: 52654).
   --no-auto-rollback  Leave a failed release live for inspection. The command
                    prints the rollback command to use manually.
   --skip-service   Skip all service management, including health polling.
  --no-build       Skip the build and stage the already-built artifacts from
                   the dev repository. By default the release invokes
                   scripts/build-prod.sh first (override the script path with
                   the KANJISCRIBE_BUILD_SCRIPT environment variable). A
                   failed build exits 3 before the target is modified in any
                   way.
  --force          Remove a stale staging directory and proceed.
  --keep N         Keep the N most recent release backups (default 3). N must
                   be a positive integer. Older backups are deleted whole.
                   Directories that do not match the backup naming pattern are
                   never considered for pruning.

Fresh install:
  When <target> does not exist yet, release performs a fresh install: the
  backup, data-copy, and swap phases are skipped and the assembled
  staging instance renames directly into place as the target, carrying an
  empty data/ skeleton (dataset import and service registration remain
  manual, documented steps). No release backup or failed-instance sibling is
  created. The target's parent directory must already exist — the rename
  needs it, and the script never creates parent directories (a missing
  parent exits 2). All guards still apply: explicit target, dev repository
  root refused, stale staging (remove with --force). A release onto the
  now-existing target behaves as a normal update again.

Flags (rollback only):
  --backup <TS>    Restore the release backup with this timestamp (the same
                   string 'list' prints) instead of the newest. An unknown or
                   invalid selector is an error (exit 7) and changes nothing.

Ownership:
  When run as root, the staged and swapped directories are chowned to the
  invoking user ($SUDO_USER, else the login name) so the service user retains
  access. If the invoking user cannot be determined, ownership is left as-is
  with a warning. When not root, no chown is performed.

Exit codes:
   1 usage error, 2 guard failure, 3 build failure, 4 service stop failure,
   5 data copy failure, 6 verification failure / auto-rollback, 7 rollback
   failure (unknown or invalid backup selector). See
   header comment.
EOF
}

# ---------------------------------------------------------------------------
# Naming helpers
# ---------------------------------------------------------------------------

# Escape-free name matchers. Anchoring is structural — a literal prefix plus a
# strictly numeric timestamp suffix — so bases containing regex metacharacters
# (dots, parens, ...) are handled correctly and foreign names (e.g. a legacy
# kanjiscribe-manual-backup) can never match.

# The timestamp suffix every managed sibling carries: YYYYmmdd-HHMMSS
# (lexically sortable). The one definition of the pattern, used by the name
# matcher and the rollback selector validation.
TS_RE='[0-9]{8}-[0-9]{6}'

# Does <name> match the managed-sibling pattern of instance basename <base>?
# <kind> is the pattern infix: "release" (release backup) or "failed" (failed
# instance). Pattern: ^<base>-<kind>-[0-9]{8}-[0-9]{6}$
is_managed_sibling_name() {
    local name="$1" base="$2" kind="$3" prefix suffix
    prefix="${base}-${kind}-"
    [[ "$name" == "${prefix}"* ]] || return 1
    suffix="${name#"$prefix"}"
    [[ "$suffix" =~ ^${TS_RE}$ ]]
}

# Echo the full paths of all managed siblings of <target> of the given
# <kind>, newest first. The single matcher is shared by `list`, `rollback`
# selection, and retention pruning, so foreign directories (which never
# match) are consistently invisible to all of them.
list_managed_siblings() {
    local target="$1" kind="$2" parent base entry name
    parent="$(dirname "$target")"
    base="$(basename "$target")"
    for entry in "$parent"/*; do
        [ -e "$entry" ] || continue
        [ -d "$entry" ] || continue
        name="$(basename "$entry")"
        is_managed_sibling_name "$name" "$base" "$kind" || continue
        printf '%s\n' "$entry"
    done | sort -r
}

# Thin kind bindings so call sites read in domain terms.
list_release_backups() { list_managed_siblings "$1" release; }
list_failed_instances() { list_managed_siblings "$1" failed; }

# Path of the newest release backup of <target> ("" when none exists).
newest_release_backup() {
    list_release_backups "$1" | head -n 1
}

# Remove all but the <keep> newest managed siblings of <target> of the given
# <kind> (retention). Only directories matching the script's own pattern are
# ever considered (via list_managed_siblings), and the newest sibling — the
# first line of the newest-first listing — is never removed. Deletion removes
# the whole backup directory. Pruning is best-effort: a failed removal is
# reported on stderr but does not fail the release (the swap already
# succeeded and was not affected).
prune_managed_siblings() {
    local target="$1" kind="$2" keep="$3" label="$4" siblings count=0 s
    siblings="$(list_managed_siblings "$target" "$kind")"
    if [ -z "$siblings" ]; then
        return 0
    fi
    echo "[retention] pruning ${label}s to the $keep most recent"
    while IFS= read -r s; do
        count=$((count + 1))
        [ "$count" -le "$keep" ] && continue
        echo "[retention] pruning ${label}: $s"
        if ! rm -rf -- "$s"; then
            err "could not prune ${label}: $s"
        fi
    done <<<"$siblings"
    return 0
}

# Release backups keep N (default 3); failed instances keep exactly 1.
prune_release_backups() { prune_managed_siblings "$1" release "$2" "release backup"; }
prune_failed_instances() { prune_managed_siblings "$1" failed 1 "failed instance"; }

# Generate the path of the next free managed sibling of the given <kind> for
# <parent>/<base>. TS is YYYYmmdd-HHMMSS; if a same-second collision exists,
# wait for the next second so an existing sibling is never overwritten.
next_managed_sibling_path() {
    local parent="$1" base="$2" kind="$3" ts path
    while :; do
        ts="$(date +%Y%m%d-%H%M%S)"
        path="$parent/${base}-${kind}-${ts}"
        if [ ! -e "$path" ]; then
            printf '%s\n' "$path"
            return 0
        fi
        echo "[release] $kind sibling name collision (${path}); waiting for the next second" >&2
        sleep 1
    done
}

next_release_backup_path() { next_managed_sibling_path "$1" "$2" release; }
next_failed_instance_path() { next_managed_sibling_path "$1" "$2" failed; }

# Set <parent_ref> and <base_ref> to the parent directory and basename of
# <target> — the pair every managed-sibling path derives from, travelling
# together so call sites don't recompute it.
target_parts() {
    local -n parent_ref="$2" base_ref="$3"
    parent_ref="$(dirname "$1")"
    base_ref="$(basename "$1")"
}

# ---------------------------------------------------------------------------
# Guards
# ---------------------------------------------------------------------------

# Common pre-flight guards, in PRD order: target exists and looks like an
# instance (apps/api/dist/server.js AND systemd/kanjiscribe.service), and is
# not the dev repository root. Prints the canonical target path on stdout when
# it passes; exits EXIT_GUARD otherwise. Used by rollback and list, and by
# release for existing targets (nonexistent targets take the fresh-install
# guard instead).
guards_common() {
    local target="$1"
    if [ ! -d "$target" ]; then
        err "target does not exist or is not a directory: $target"
        exit "$EXIT_GUARD"
    fi
    target="$(realpath -e "$target")" || {
        err "could not resolve target path: $1"
        exit "$EXIT_GUARD"
    }
    if [ ! -f "$target/apps/api/dist/server.js" ] || [ ! -f "$target/systemd/kanjiscribe.service" ]; then
        err "target does not look like a KanjiScribe instance: $target"
        err "an instance must contain both apps/api/dist/server.js and systemd/kanjiscribe.service"
        exit "$EXIT_GUARD"
    fi
    if [ "$target" = "$REPO_ROOT_REAL" ]; then
        err "refusing to release into the dev repository root: $target"
        err "the dev repository is the source of releases, never their target"
        exit "$EXIT_GUARD"
    fi
    printf '%s\n' "$target"
}

# Guards for a fresh-install target (release only, issue 05): the target does
# not exist, which is precisely what makes it a valid fresh install. Its
# parent must exist and be a directory — the fresh install renames the staged
# instance into the parent, and a rename needs the parent; the script never
# creates parent directories itself (a missing parent is a guard failure). The
# dev repository root is still refused. Prints the canonical target path on
# stdout when it passes; exits EXIT_GUARD otherwise.
guards_fresh_target() {
    local target="$1" parent canonical
    parent="$(dirname "$target")"
    if [ ! -d "$parent" ]; then
        err "the target's parent directory does not exist: $parent"
        err "a fresh install renames the staged instance into that directory, so the parent must already exist — create it first (the script never creates parent directories)"
        exit "$EXIT_GUARD"
    fi
    canonical="$(realpath -m "$target")" || {
        err "could not resolve target path: $target"
        exit "$EXIT_GUARD"
    }
    if [ "$canonical" = "$REPO_ROOT_REAL" ]; then
        err "refusing to release into the dev repository root: $canonical"
        err "the dev repository is the source of releases, never their target"
        exit "$EXIT_GUARD"
    fi
    printf '%s\n' "$canonical"
}

# Refuse a stale staging directory unless --force is given (which removes it).
guards_staging() {
    local target="$1" force="$2" staging="${target}.staging"
    if [ ! -e "$staging" ]; then
        return 0
    fi
    if [ "$force" -eq 1 ]; then
        echo "[stage] removing stale staging directory (--force): $staging"
        if ! rm -rf -- "$staging"; then
            err "could not remove the stale staging directory: $staging"
            return "$EXIT_GUARD"
        fi
        return 0
    fi
    err "stale staging directory exists: $staging"
    err "a previous release may have crashed; re-run with --force to remove it and proceed"
    return "$EXIT_GUARD"
}

# Do the stage sources exist in the dev repository (the bundled API server and
# the built frontend)? Pure check: emits specific errors and returns 1 when
# something is missing. Callers bucket the failure — guard-class (2) in
# no-build mode (prebuilt artifacts missing) and build-class (3) after a build
# that reported success but produced nothing.
stage_sources_present() {
    if [ ! -f "$REPO_ROOT/apps/api/dist/server.js" ]; then
        err "API bundle missing in the dev repository: $REPO_ROOT/apps/api/dist/server.js"
        return 1
    fi
    if [ ! -f "$REPO_ROOT/apps/web/dist/index.html" ]; then
        err "frontend missing in the dev repository: $REPO_ROOT/apps/web/dist/index.html"
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Build and ownership (issue 04)
# ---------------------------------------------------------------------------

# Run the build script (default mode). A failure exits EXIT_BUILD before the
# target has been modified in any way — no staging directory, no renames.
run_build() {
    local rc=0
    echo "[build] building with: $BUILD_SCRIPT"
    "$BUILD_SCRIPT" || rc=$?
    if [ "$rc" -ne 0 ]; then
        err "build failed (exit code $rc): $BUILD_SCRIPT"
        err "the live instance was not touched — fix the build and re-run"
        return "$EXIT_BUILD"
    fi
    echo "[build] build complete"
    return 0
}

# Resolve the invoking user once per run, for the ownership fix-up. When not
# root, returns 1 (no chown needed — everything the script creates is already
# owned by the invoking user). When root, the chain is $SUDO_USER -> logname
# -> unknown; an unknown user returns 1 after a warning, so the chown is
# skipped rather than guessed. The first call resolves; later calls reuse the
# cached result.
resolve_ownership() {
    local login_user
    if [ "$OWNERSHIP_RESOLVED" -eq 1 ]; then
        [ -n "$INVOKING_USER" ]
        return
    fi
    OWNERSHIP_RESOLVED=1
    if [ "$(id -u)" -ne 0 ]; then
        return 1
    fi
    if [ -n "${SUDO_USER:-}" ]; then
        INVOKING_USER="$SUDO_USER"
        return 0
    fi
    if login_user="$(logname 2>/dev/null)" && [ -n "$login_user" ]; then
        INVOKING_USER="$login_user"
        return 0
    fi
    echo "[ownership] WARNING: running as root but the invoking user could not be determined (no SUDO_USER, no login name) — leaving ownership as-is" >&2
    return 1
}

# Apply the invoking user's ownership to <path> recursively (group = the
# user's login group, via the 'user:' chown form). Best-effort: a failed
# chown is reported on stderr but does not fail the pipeline. Non-root runs
# and unknown invoking users skip silently (after the one-time warning above).
apply_ownership() {
    local path="$1"
    if ! resolve_ownership; then
        return 0
    fi
    if ! chown -R -- "$INVOKING_USER": "$path" 2>/dev/null; then
        err "could not apply ownership of $INVOKING_USER to: $path"
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Release pipeline phases
# ---------------------------------------------------------------------------

# Assemble a complete, self-contained staging instance: bundled API server,
# built frontend, systemd unit, docs, data directory, and the production-only
# native dependency installed via npm (a minimal package.json in the instance
# plus a plain npm install).
assemble_staging() {
    local staging="$1" npm_log
    echo "[stage] assembling staging instance at: $staging"
    if ! mkdir -p \
        "$staging/apps/api/dist" \
        "$staging/apps/web/dist" \
        "$staging/systemd" \
        "$staging/docs" \
        "$staging/data"; then
        err "could not create the staging directory structure under: $staging"
        return "$EXIT_GUARD"
    fi
    echo "[stage] copying API bundle (apps/api/dist)"
    if ! cp -a "$REPO_ROOT/apps/api/dist/." "$staging/apps/api/dist/"; then
        err "could not copy the API bundle into staging"
        return "$EXIT_GUARD"
    fi
    echo "[stage] copying frontend (apps/web/dist)"
    if ! cp -a "$REPO_ROOT/apps/web/dist/." "$staging/apps/web/dist/"; then
        err "could not copy the frontend into staging"
        return "$EXIT_GUARD"
    fi
    echo "[stage] copying systemd unit (systemd/kanjiscribe.service)"
    if ! cp "$REPO_ROOT/systemd/kanjiscribe.service" "$staging/systemd/kanjiscribe.service"; then
        err "could not copy the systemd unit into staging"
        return "$EXIT_GUARD"
    fi
    echo "[stage] copying docs"
    if ! cp -a "$REPO_ROOT/docs/." "$staging/docs/"; then
        err "could not copy docs into staging"
        return "$EXIT_GUARD"
    fi
    echo "[stage] writing minimal apps/api/package.json"
    if ! cat >"$staging/apps/api/package.json" <<'EOF'
{
  "name": "@kanjiscribe/api-prod",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "better-sqlite3": "^11.8.1"
  }
}
EOF
    then
        err "could not write the staging package.json"
        return "$EXIT_GUARD"
    fi
    echo "[stage] installing native dependency (better-sqlite3) with npm"
    npm_log="$(mktemp)"
    if ! (cd "$staging/apps/api" && npm install --omit=dev --no-package-lock) >"$npm_log" 2>&1; then
        err "npm install of the native dependency failed inside staging"
        sed -n '1,20p' "$npm_log" >&2
        rm -f -- "$npm_log"
        return "$EXIT_GUARD"
    fi
    rm -f -- "$npm_log"
    echo "[stage] staging instance assembled"
    return 0
}

# Invoke systemctl directly as root, or through sudo for an unprivileged
# operator. Keeping this decision in one helper makes it impossible for one
# service action to accidentally use a different privilege path.
systemctl_action() {
    if [ "$(id -u)" -eq 0 ]; then
        systemctl "$@"
    else
        sudo systemctl "$@"
    fi
}

# Service stop point. Runs before the data copy so the copy captures a
# clean, WAL-checkpointed database. A stop failure aborts the release
# (EXIT_STOP); on a fresh install (allow_unregistered=1) the expected "unit
# not loaded" stop error is treated as success — no registered unit exists
# yet, so there is nothing to stop.
stop_service() {
    local service="$1" allow_unregistered="${2:-0}" output rc=0
    echo "[service] stopping service: $service"
    output="$(systemctl_action stop "$service" 2>&1)" || rc=$?
    if [ "$rc" -ne 0 ]; then
        if [ "$allow_unregistered" -eq 1 ] && [[ "$output" =~ [Uu]nit.*(not loaded|not-found)|[Nn]ot.loaded|[Nn]ot.found ]]; then
            echo "[service] service unit is not registered yet; continuing fresh install"
            return 0
        fi
        [ -n "$output" ] && printf '%s\n' "$output" >&2
        err "could not stop service '$service'; release aborted before data copy or swap"
        return "$EXIT_STOP"
    fi
    echo "[service] service stopped: $service"
    return 0
}

# Start the service after the instance swap. A failure is deliberately mapped
# to verification-class handling: the new live instance must not be assumed
# healthy merely because systemctl accepted the command unsuccessfully.
start_service() {
    local service="$1" output rc=0
    echo "[service] starting service: $service"
    output="$(systemctl_action start "$service" 2>&1)" || rc=$?
    if [ "$rc" -ne 0 ]; then
        [ -n "$output" ] && printf '%s\n' "$output" >&2
        err "could not start service '$service'; release verification failed"
        return "$EXIT_VERIFY"
    fi
    echo "[service] service start requested: $service"
    return 0
}

# After an automatic rollback the service may already be running code from the
# failed instance. A plain start would leave that process in place, so the
# rollback path uses a real restart rather than reusing start_service.
restart_service() {
    local service="$1" output rc=0
    echo "[service] restarting service: $service"
    output="$(systemctl_action restart "$service" 2>&1)" || rc=$?
    if [ "$rc" -ne 0 ]; then
        [ -n "$output" ] && printf '%s\n' "$output" >&2
        err "could not restart service '$service' after automatic rollback"
        return "$EXIT_VERIFY"
    fi
    echo "[service] service restart requested: $service"
    return 0
}

# Poll status only. The endpoint body is intentionally ignored: the release
# contract is an HTTP 200 from /health, not a particular JSON representation.
verify_health() {
    local port="$1" url="http://localhost:${1}/health" status attempt=0
    echo "[verify] polling health endpoint: $url (30 second budget, every 2 seconds)"
    # Fifteen attempts with a two-second interval provide the documented
    # thirty-second budget. curl has a bounded request time so a dead endpoint
    # cannot make an individual poll run forever.
    while [ "$attempt" -lt 15 ]; do
        attempt=$((attempt + 1))
        status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 0.1 "$url" 2>/dev/null)" || status=""
        if [ "$status" = 200 ]; then
            echo "[verify] health verification succeeded (HTTP 200)"
            return 0
        fi
        [ "$attempt" -lt 15 ] && sleep 2
    done
    err "health verification failed: $url did not return HTTP 200 within 30 seconds"
    return "$EXIT_VERIFY"
}

# Copy the live instance's data/ (kanjiscribe.db, WAL sidecars, kanji-svg/)
# into staging. The dev repository's data/ is never involved. If WAL sidecar
# files survive, they are copied too and a WARNING is emitted — pending writes
# are never silently dropped. Failures exit with EXIT_DATA_COPY.
copy_live_data() {
    local live="$1" staging="$2" f warned=0
    echo "[data] copying live data into staging: $live/data -> $staging/data"
    if [ -e "$live/data" ] && [ ! -d "$live/data" ]; then
        err "live data path exists but is not a directory: $live/data"
        err "refusing to copy; nothing was copied"
        return "$EXIT_DATA_COPY"
    fi
    if [ -d "$live/data" ]; then
        if ! cp -a "$live/data/." "$staging/data/"; then
            err "failed to copy live data into staging: $live/data -> $staging/data"
            return "$EXIT_DATA_COPY"
        fi
    fi
    for f in kanjiscribe.db-wal kanjiscribe.db-shm; do
        if [ -f "$staging/data/$f" ]; then
            if [ "$warned" -eq 0 ]; then
                echo "[data] WARNING: WAL sidecar files survived the copy and were copied into staging — nothing was dropped, but the database may reflect an unclean shutdown" >&2
                warned=1
            fi
            echo "[data]   WAL sidecar copied: data/$f" >&2
        fi
    done
    return 0
}

# The two-rename swap mechanics shared by release, rollback, and automatic
# rollback (ADR-0009): rename <first_from> to <first_to>, then <second_from>
# to <second_to>; if the second rename fails, undo the first. Returns 0 on
# success, 1 when the first rename failed, 2 when the second failed and the
# first was undone, 3 when the second failed and the undo failed too.
rename_swap() {
    if ! mv -- "$1" "$2"; then
        return 1
    fi
    if ! mv -- "$3" "$4"; then
        if mv -- "$2" "$1"; then
            return 2
        fi
        return 3
    fi
    return 0
}

# The instance swap (ADR-0009): two atomic renames — live -> release backup,
# staging -> live. No copy step ever exists between live and backup. On a
# failed second rename the first rename is rolled back.
swap_instances() {
    local live="$1" staging="$2" backup="$3" rc=0
    echo "[swap] live -> release backup: $backup"
    echo "[swap] staging -> live: $live"
    rename_swap "$live" "$backup" "$staging" "$live" || rc=$?
    case "$rc" in
    1)
        err "swap failed: could not rename live instance to release backup: $backup"
        return "$EXIT_GUARD"
        ;;
    2)
        err "swap failed: could not rename staging instance into the live slot: $live"
        err "restored the live instance from the release backup"
        return "$EXIT_GUARD"
        ;;
    3)
        err "swap failed: could not rename staging instance into the live slot: $live"
        err "restore failed too — the previous instance remains at: $backup"
        return "$EXIT_GUARD"
        ;;
    esac
    STAGING=""
    return 0
}

# Move a failed live instance aside as a Failed instance, then restore the
# release backup that was created by the swap. The broken instance is never
# converted into a release backup: it moves directly to the failed pattern.
auto_rollback_failed_release() {
    local target="$1" service="$2" keep="$3"
    local parent base failed backup rc=0

    target_parts "$target" parent base
    backup="$(newest_release_backup "$target")"
    if [ -z "$backup" ]; then
        err "automatic rollback could not find the pre-release release backup"
        return 1
    fi
    failed="$(next_failed_instance_path "$parent" "$base")"

    echo "[rollback] moving failed live instance aside: $failed"
    echo "[rollback] restoring release backup into live slot: $target"
    rename_swap "$target" "$failed" "$backup" "$target" || rc=$?
    case "$rc" in
    1)
        err "automatic rollback failed: could not preserve the failed instance at: $failed"
        return 1
        ;;
    2)
        err "automatic rollback failed: could not restore the release backup into the live slot"
        err "the failed instance was moved back into the live slot"
        return 1
        ;;
    3)
        err "automatic rollback failed: could not restore the release backup into the live slot"
        err "undo failed too — the failed instance remains at: $failed"
        return 1
        ;;
    esac

    echo "[rollback] restarting service after automatic rollback: $service"
    if ! restart_service "$service"; then
        err "automatic rollback restored the previous instance, but the service restart failed"
    fi
    prune_failed_instances "$target"
    prune_release_backups "$target" "$keep"
    echo "[rollback] failed instance retained for inspection: $failed"
    return 0
}

# Start the service and poll /health; returns 0 on success or EXIT_VERIFY on
# any failure. Skip-service mode skips both steps entirely.
start_and_verify() {
    local skip_service="$1" service="$2" health_port="$3" rc=0
    if [ "$skip_service" -eq 1 ]; then
        echo "[service] service start and health verification: skipped"
        return 0
    fi
    start_service "$service" || rc=$?
    if [ "$rc" -eq 0 ]; then
        verify_health "$health_port" || rc=$?
    fi
    return "$rc"
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

# Walk a subcommand's arguments once. The structural cases are handled here:
# -h/--help prints usage and exits 0; an unknown -* option and a second
# positional argument are usage errors (exit EXIT_USAGE); the single
# positional argument is stored in the variable named by <target_var>.
# Recognized flags are dispatched to <flag_handler> as (flag) or, for the
# flags listed in <value_flags>, as (flag, value) — a value flag without a
# value is a usage error. A handler that returns non-zero marks its flag
# unknown.
parse_args() {
    local target_var="$1" flag_handler="$2" value_flags="$3" arg value
    local -n target_ref="$target_var"
    shift 3
    while [ "$#" -gt 0 ]; do
        arg="$1"
        shift
        case "$arg" in
        -h | --help)
            usage
            exit 0
            ;;
        -*)
            if [[ " $value_flags " == *" $arg "* ]]; then
                if [ "$#" -eq 0 ]; then
                    err "$arg requires a value"
                    usage >&2
                    exit "$EXIT_USAGE"
                fi
                value="$1"
                shift
                if ! "$flag_handler" "$arg" "$value"; then
                    err "unknown option: $arg"
                    usage >&2
                    exit "$EXIT_USAGE"
                fi
            elif ! "$flag_handler" "$arg"; then
                err "unknown option: $arg"
                usage >&2
                exit "$EXIT_USAGE"
            fi
            ;;
        *)
            if [ -n "$target_ref" ]; then
                err "unexpected extra argument: $arg (target already set to: $target_ref)"
                usage >&2
                exit "$EXIT_USAGE"
            fi
            target_ref="$arg"
            ;;
        esac
    done
}

# Flag handler for subcommands that take no flags at all.
reject_all_flags() { return 1; }

# ---------------------------------------------------------------------------
# Subcommands
# ---------------------------------------------------------------------------

cmd_release() {
    local skip_service=0 no_build=0 force=0 auto_rollback=1 keep=3
    local service="kanjiscribe" health_port=52654 target_arg=""

    handle_release_flag() {
        case "$1" in
        --skip-service) skip_service=1 ;;
        --no-build) no_build=1 ;;
        --no-auto-rollback) auto_rollback=0 ;;
        --force) force=1 ;;
        --service) service="$2" ;;
        --health-port) health_port="$2" ;;
        --keep) keep="$2" ;;
        *) return 1 ;;
        esac
        return 0
    }
    parse_args target_arg handle_release_flag "--service --health-port --keep" "$@"

    if [ -z "$target_arg" ]; then
        err "release requires an explicit target instance directory"
        usage >&2
        exit "$EXIT_USAGE"
    fi
    if ! [[ "$keep" =~ ^[0-9]+$ ]] || [ "$keep" -lt 1 ]; then
        err "--keep must be a positive integer (the number of release backups to retain), got: $keep"
        usage >&2
        exit "$EXIT_USAGE"
    fi
    if [ -z "$service" ]; then
        err "--service must not be empty"
        usage >&2
        exit "$EXIT_USAGE"
    fi
    if ! [[ "$health_port" =~ ^[0-9]+$ ]] || [ "$health_port" -lt 1 ] || [ "$health_port" -gt 65535 ]; then
        err "--health-port must be a port number from 1 to 65535, got: $health_port"
        usage >&2
        exit "$EXIT_USAGE"
    fi

    # Guards, in PRD order: explicit target (above) -> target exists and looks
    # like an instance, or is a valid fresh-install target -> not the dev root
    # -> no stale staging -> build (default) or prebuilt stage sources
    # (--no-build).
    local target fresh_install=0
    if [ -e "$target_arg" ] || [ -L "$target_arg" ]; then
        target="$(guards_common "$target_arg")" || exit "$EXIT_GUARD"
    else
        # Fresh install (issue 05): a nonexistent target is valid precisely
        # because it does not exist — there is no live instance to back up,
        # copy data from, or swap with, so the staged instance renames
        # directly into place as the target.
        target="$(guards_fresh_target "$target_arg")" || exit "$EXIT_GUARD"
        fresh_install=1
    fi
    guards_staging "$target" "$force" || exit "$EXIT_GUARD"

    # Build (issue 04): by default the build script runs before staging
    # anything, so a build failure leaves the target untouched (no staging
    # directory, no renames). --no-build stages the already-built artifacts.
    if [ "$no_build" -eq 1 ]; then
        echo "[build] no-build mode: staging prebuilt artifacts from the dev repository"
        if ! stage_sources_present; then
            err "run scripts/build-prod.sh first, or drop --no-build to build automatically"
            exit "$EXIT_GUARD"
        fi
    else
        run_build || exit "$EXIT_BUILD"
        if ! stage_sources_present; then
            err "the build reported success but produced no artifacts"
            err "check the build script output; the live instance was not touched"
            exit "$EXIT_BUILD"
        fi
    fi

    STAGING="${target}.staging"

    echo "[release] target: $target"
    echo "[release] staging at: $STAGING"
    if [ "$skip_service" -eq 1 ]; then
        echo "[service] skip-service mode: the script will not touch systemctl"
    else
        echo "[service] service: $service; health port: $health_port"
    fi

    assemble_staging "$STAGING" || exit "$EXIT_GUARD"
    # Ownership (issue 04): the staged tree (build artifacts, native
    # dependency) belongs to the invoking user when running as root.
    apply_ownership "$STAGING"

    if [ "$fresh_install" -eq 1 ]; then
        release_fresh_install "$target" "$service" "$health_port" "$skip_service" "$keep"
    else
        release_update "$target" "$service" "$health_port" "$skip_service" "$auto_rollback" "$keep"
    fi
    return 0
}

# Promote the staged instance over an existing live instance: stop the
# service, copy the live data into staging, swap (ADR-0009), start, and
# verify — rolling back automatically when verification fails.
release_update() {
    local target="$1" service="$2" health_port="$3" skip_service="$4" auto_rollback="$5" keep="$6"

    # Service stop is deliberately after build/staging and before the data
    # copy, so the copy captures a clean, WAL-checkpointed database.
    if [ "$skip_service" -eq 1 ]; then
        echo "[service] service stop: skipped"
    else
        stop_service "$service" || exit "$EXIT_STOP"
    fi

    copy_live_data "$target" "$STAGING" || exit "$EXIT_DATA_COPY"

    local parent base backup
    target_parts "$target" parent base
    backup="$(next_release_backup_path "$parent" "$base")"
    swap_instances "$target" "$STAGING" "$backup" || exit "$EXIT_GUARD"
    # Ownership (issue 04): both swap results — the new live instance and
    # the release backup — belong to the invoking user; the live chown
    # also covers the copied data files.
    apply_ownership "$target"
    apply_ownership "$backup"

    if ! start_and_verify "$skip_service" "$service" "$health_port"; then
        if [ "$auto_rollback" -eq 1 ]; then
            if auto_rollback_failed_release "$target" "$service" "$keep"; then
                err "release failed verification; automatic rollback restored the previous instance"
            else
                err "release failed verification and automatic rollback FAILED"
                err "the failed release is still live at: $target — inspect it, then roll back by hand: $0 rollback $target"
            fi
        else
            err "release failed verification; the failed release remains live for inspection"
            err "run: $0 rollback $target"
            prune_release_backups "$target" "$keep"
        fi
        exit "$EXIT_VERIFY"
    fi

    echo "[ok] release complete: $target"
    echo "[ok] previous instance preserved as release backup: $backup"

    # Retention: prune release backups to the N most recent. Only pattern-
    # matching siblings are ever considered; the newest backup is always kept.
    prune_release_backups "$target" "$keep"
    return 0
}

# Fresh install (issue 05): no live instance exists, so there is nothing to
# copy and nothing to back up. The staged instance — carrying the empty
# data/ skeleton assembled by assemble_staging (dataset import remains a
# manual documented step) — renames directly into place as the target.
release_fresh_install() {
    local target="$1" service="$2" health_port="$3" skip_service="$4" keep="$5"

    echo "[release] fresh install: the target does not exist — backup, data copy, and swap are skipped"

    if [ "$skip_service" -eq 1 ]; then
        echo "[service] service stop: skipped"
    else
        # The unit is usually not registered yet; the expected "unit not
        # loaded" stop error is tolerated.
        stop_service "$service" 1 || exit "$EXIT_STOP"
    fi

    echo "[data] skipped: fresh install (data/ stays empty; dataset import is a manual step)"

    # The fresh-install rename: one atomic rename, staging -> target. No
    # release backup and no failed-instance sibling is created; the target's
    # parent was guarded to exist so the rename can succeed.
    echo "[swap] staging -> target (fresh install): $target"
    if ! mv -- "$STAGING" "$target"; then
        err "fresh install failed: could not rename the staged instance into place: $target"
        exit "$EXIT_GUARD"
    fi
    STAGING=""
    # Ownership (issues 04/05): the fresh target gets the invoking user's
    # ownership after the rename, exactly like a swapped instance does.
    apply_ownership "$target"

    if ! start_and_verify "$skip_service" "$service" "$health_port"; then
        err "release failed verification; automatic rollback cannot restore a fresh install (no release backup exists)"
        err "the failed release is still live at: $target — reinstall it by hand"
        exit "$EXIT_VERIFY"
    fi

    echo "[ok] release complete: $target (fresh install)"
    echo "[ok] no release backup was created — there was no previous instance; dataset import and service registration remain manual steps"

    # Retention is a no-op on a fresh install (no siblings exist yet); the
    # step is kept so every release path ends with the same retention guard.
    prune_release_backups "$target" "$keep"
    return 0
}

cmd_rollback() {
    local backup_ts="" target_arg=""

    handle_rollback_flag() {
        case "$1" in
        --backup) backup_ts="$2" ;;
        *) return 1 ;;
        esac
        return 0
    }
    parse_args target_arg handle_rollback_flag "--backup" "$@"

    if [ -z "$target_arg" ]; then
        err "rollback requires an explicit target instance directory"
        usage >&2
        exit "$EXIT_USAGE"
    fi

    local target
    target="$(guards_common "$target_arg")" || exit "$EXIT_GUARD"

    local parent base backup
    target_parts "$target" parent base

    if [ -n "$backup_ts" ]; then
        # The selector is a strictly numeric timestamp, so the constructed
        # path can only ever name a directory matching the script's own
        # release-backup pattern — a foreign directory can never be selected.
        if [[ ! "$backup_ts" =~ ^${TS_RE}$ ]]; then
            err "rollback failed: invalid backup selector: $backup_ts"
            err "the selector must be a timestamp of the form YYYYmmdd-HHMMSS, as printed by 'list'"
            exit "$EXIT_ROLLBACK"
        fi
        backup="$parent/${base}-release-${backup_ts}"
        if [ ! -d "$backup" ]; then
            err "rollback failed: no release backup with timestamp $backup_ts found for: $target"
            err "run 'list $target' to see the available backups"
            exit "$EXIT_ROLLBACK"
        fi
    else
        backup="$(newest_release_backup "$target")"
        if [ -z "$backup" ]; then
            err "rollback failed: no release backups found for: $target"
            err "nothing to roll back to; run 'release' first or use 'list' to inspect backups"
            exit "$EXIT_GUARD"
        fi
    fi

    local aside rc=0
    aside="$(next_release_backup_path "$parent" "$base")"

    echo "[rollback] target: $target"
    if [ -n "$backup_ts" ]; then
        echo "[rollback] restoring selected release backup: $backup"
    else
        echo "[rollback] restoring newest release backup: $backup"
    fi
    echo "[swap] live -> release backup: $aside"
    echo "[swap] release backup -> live: $target"
    rename_swap "$target" "$aside" "$backup" "$target" || rc=$?
    case "$rc" in
    1)
        err "rollback failed: could not move the live instance aside: $aside"
        exit "$EXIT_GUARD"
        ;;
    2)
        err "rollback failed: could not move the release backup into the live slot"
        err "restored the live instance from: $aside"
        exit "$EXIT_GUARD"
        ;;
    3)
        err "rollback failed: could not move the release backup into the live slot"
        err "restore failed too — the previous live instance remains at: $aside"
        exit "$EXIT_GUARD"
        ;;
    esac
    echo "[ok] rollback complete: $target is the previous instance again"
    echo "[ok] the rolled-back instance is preserved as release backup: $aside"
    # Ownership (issue 04): the restored live instance gets the invoking
    # user's ownership, so a rollback undoes a root-owned backup exactly as
    # the release path does. The moved-aside instance keeps whatever
    # ownership it already had.
    apply_ownership "$target"
    return 0
}

cmd_list() {
    local target_arg=""
    parse_args target_arg reject_all_flags "" "$@"
    if [ -z "$target_arg" ]; then
        err "list requires an explicit target instance directory"
        usage >&2
        exit "$EXIT_USAGE"
    fi

    local target
    target="$(guards_common "$target_arg")" || exit "$EXIT_GUARD"

    local base backups failed b name ts
    base="$(basename "$target")"
    backups="$(list_release_backups "$target")"
    failed="$(list_failed_instances "$target")"
    if [ -z "$backups" ] && [ -z "$failed" ]; then
        echo "no release backups or failed instances found for: $target"
        return 0
    fi
    # Release backups first (these are the rollback selectors), then failed
    # instances; a third column marks the kind so the two are never confused.
    if [ -n "$backups" ]; then
        while IFS= read -r b; do
            name="$(basename "$b")"
            ts="${name#"${base}-release-"}"
            printf '%s\t%s\trelease\n' "$name" "$ts"
        done <<<"$backups"
    fi
    if [ -n "$failed" ]; then
        while IFS= read -r b; do
            name="$(basename "$b")"
            ts="${name#"${base}-failed-"}"
            printf '%s\t%s\tfailed\n' "$name" "$ts"
        done <<<"$failed"
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

main() {
    local sub="${1:-}"
    if [ -z "$sub" ]; then
        usage >&2
        exit "$EXIT_USAGE"
    fi
    case "$sub" in
    -h | --help | help)
        usage
        exit 0
        ;;
    release)
        shift
        cmd_release "$@"
        ;;
    rollback)
        shift
        cmd_rollback "$@"
        ;;
    list)
        shift
        cmd_list "$@"
        ;;
    *)
        err "unknown subcommand: $sub"
        usage >&2
        exit "$EXIT_USAGE"
        ;;
    esac
}

main "$@"
