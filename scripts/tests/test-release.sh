#!/bin/bash
# Test harness for scripts/release.sh — black-box tests at the CLI seam.
#
# Per the PRD's Testing Decisions, the release script's own CLI is the only
# seam: tests execute it as a black box and assert on exit codes, output, and
# the resulting filesystem state. No test inspects script internals.
#
# Every test runs against throwaway sandbox fixtures under mktemp -d (cleaned
# up by an EXIT trap). No test ever references a real instance directory.
#
# Service/build tooling is faked via stubs on PATH:
#   - npm       logs its invocation, plants a fake node_modules tree in its
#               working directory, and succeeds (keeps the suite fast, and
#               makes the installed native dependency observable)
#   - systemctl stub: records invocations, can fail actions, and can spawn a
#     tiny real health server for service-mode tests
#   - pnpm       poison stub: fails if ever invoked (the build script is
#                stubbed via KANJISCRIBE_BUILD_SCRIPT, so pnpm must never run)
#   - date       deterministic fake timestamps when FAKE_DATE_FILE is exported
#   - build-prod.sh  the default build stub, exported as KANJISCRIBE_BUILD_SCRIPT
#                (issue 04's build seam): records invocations and writes a
#                fresh marker artifact into the dev repo's apps/api/dist;
#                tests asserting build behavior override it with their own stub
#   - id/chown   pass-through stubs with opt-in knobs for ownership tests
#
# Runnable directly:  bash scripts/tests/test-release.sh
# All later slices append their tests to this file.

set -u
# Deliberately no `set -e`: each test asserts its own expectations via the
# assert helpers, and run_test wraps every test in its own (set -e) subshell.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RELEASE_SCRIPT="$REPO_ROOT/scripts/release.sh"

# Naming-pattern constants, kept in lockstep with the script's own patterns
# (black-box tests cannot import them; the anchored-matching assertions
# below use these so a drift between the script and its tests fails loudly).
TS_RE='[0-9]{8}-[0-9]{6}'
TAB=$'\t'
RELEASE_BACKUP_NAME_RE="^kanjiscribe-release-${TS_RE}\$"
FAILED_INSTANCE_NAME_RE="^kanjiscribe-failed-${TS_RE}\$"
LIST_RELEASE_LINE_RE="^kanjiscribe-release-${TS_RE}${TAB}${TS_RE}${TAB}release\$"
LIST_FAILED_LINE_RE="^kanjiscribe-failed-${TS_RE}${TAB}${TS_RE}${TAB}failed\$"

PASS=0
FAIL=0
FAILED_NAMES=()

# ---------------------------------------------------------------------------
# Assertion helpers (minimal)
# ---------------------------------------------------------------------------

die() {
    echo "FAIL: $*" >&2
    exit 1
}

assert_eq() { # expected actual [message]
    local expected="$1" actual="$2" msg="${3:-}"
    [ "$expected" = "$actual" ] || die "assert_eq ${msg:+($msg)}: expected [$expected], got [$actual]"
}

assert_exists() { # path [message]
    [ -e "$1" ] || die "assert_exists ${2:+($2)}: [$1] does not exist"
}

assert_not_exists() { # path [message]
    [ ! -e "$1" ] || die "assert_not_exists ${2:+($2)}: [$1] exists"
}

assert_matches() { # value regex [message]
    local value="$1" regex="$2" msg="${3:-}"
    [[ "$value" =~ $regex ]] || die "assert_matches ${msg:+($msg)}: [$value] !~ [$regex]"
}

# ---------------------------------------------------------------------------
# Sandbox management
# ---------------------------------------------------------------------------

# Sandbox registry: sandbox paths are appended to a registry FILE (not an
# array), because new_sandbox is always called through $(...) command
# substitution and array appends would die with the subshell. Each test
# subshell gets its own registry so its fixtures are cleaned up on exit, even
# when the test fails. The parent registry holds the shared stub sandbox.
SANDBOX_REGISTRY="$(mktemp)" || die "mktemp failed"
export SANDBOX_REGISTRY

cleanup_sandboxes() {
    local d pid
    if [ -n "${SYSTEMCTL_PIDS:-}" ] && [ -f "${SYSTEMCTL_PIDS}" ]; then
        while IFS= read -r pid; do
            [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
        done <"${SYSTEMCTL_PIDS}"
    fi
    if [ -n "${SANDBOX_REGISTRY:-}" ] && [ -f "${SANDBOX_REGISTRY}" ]; then
        while IFS= read -r d; do
            [ -n "$d" ] && rm -rf -- "$d"
        done <"${SANDBOX_REGISTRY}"
        rm -f -- "${SANDBOX_REGISTRY}"
    fi
    # The build stubs write their fresh-artifact marker into the dev
    # repository's apps/api/dist; never leave it behind.
    rm -f -- "${BUILD_MARKER}"
}
trap cleanup_sandboxes EXIT

new_sandbox() {
    local d
    d="$(mktemp -d "${TMPDIR:-/tmp}/kanjiscribe-release-test.XXXXXX")" || die "mktemp -d failed"
    if [ -n "${SANDBOX_REGISTRY:-}" ]; then
        printf '%s\n' "$d" >>"${SANDBOX_REGISTRY}"
    fi
    printf '%s\n' "$d"
}

# ---------------------------------------------------------------------------
# Tool stubs (one shared sandbox)
# ---------------------------------------------------------------------------

STUBBIN="$(new_sandbox)/bin"
mkdir -p "$STUBBIN"
STUB_NPM_LOG="$STUBBIN/npm-invocations.log"
SYSTEMCTL_MARKER="$STUBBIN/systemctl-called"
SYSTEMCTL_LOG="$STUBBIN/systemctl-invocations.log"
SYSTEMCTL_PIDS="$STUBBIN/systemctl-pids.log"
PNPM_MARKER="$STUBBIN/pnpm-called"
CURL_MARKER="$STUBBIN/curl-polls"
SUDO_MARKER="$STUBBIN/sudo-called"
FAKE_DATE_FILE="$STUBBIN/fake-date-count"
STUB_BUILD_LOG="$STUBBIN/build-prod-invocations.log"
# The fresh artifact the build stubs write into the dev repo's apps/api/dist
# (the staging source). Cleaned up by cleanup_sandboxes on every exit.
BUILD_MARKER="$REPO_ROOT/apps/api/dist/.release-test-build-marker"

export STUB_NPM_LOG SYSTEMCTL_MARKER SYSTEMCTL_LOG SYSTEMCTL_PIDS PNPM_MARKER CURL_MARKER SUDO_MARKER FAKE_DATE_FILE STUB_BUILD_LOG
export BUILD_MARKER
export PATH="$STUBBIN:$PATH"
# The release script's default build mode invokes scripts/build-prod.sh; point
# the seam at the harness's stub build so no test ever runs the real build
# (pnpm install + workspace builds). Tests that assert build behavior export
# their own KANJISCRIBE_BUILD_SCRIPT inside their subshell.
export KANJISCRIBE_BUILD_SCRIPT="$STUBBIN/build-prod.sh"

cat >"$STUBBIN/npm" <<'EOF'
#!/bin/bash
# Stub npm: fakes a successful install and logs the invocation so tests can
# assert the exact args and the working directory the script used. It also
# plants a fake node_modules/better-sqlite3 tree in its working directory
# (the staging apps/api dir), so the installed native dependency is
# observable in the resulting instance (fresh installs included).
printf '%s|npm|%s\n' "$(pwd)" "$*" >>"${STUB_NPM_LOG}"
mkdir -p node_modules/better-sqlite3
echo "stub native module" >node_modules/better-sqlite3/.stub-marker
exit 0
EOF

cat >"$STUBBIN/systemctl" <<'EOF'
#!/bin/bash
# Service stub: records calls and optionally fails or starts the staged fixture
# server. Skip-service tests still prove that this file is never invoked.
touch "${SYSTEMCTL_MARKER}"
printf '%s\n' "$*" >>"${SYSTEMCTL_LOG}"

if [ "${1:-}" = stop ] || [ "${1:-}" = restart ]; then
    if [ "${STUB_SYSTEMCTL_FAIL_STOP:-}" = 1 ]; then
        echo "stub stop failure" >&2
        exit 1
    fi
    if [ "${STUB_SYSTEMCTL_FAIL_STOP:-}" = unit-not-loaded ]; then
        echo "Unit ${2:-kanjiscribe}.service not loaded." >&2
        exit 5
    fi
    if [ -f "${SYSTEMCTL_PIDS}" ]; then
        while IFS= read -r pid; do
            [ -n "$pid" ] || continue
            kill "$pid" 2>/dev/null || true
        done <"${SYSTEMCTL_PIDS}"
        : >"${SYSTEMCTL_PIDS}"
    fi
fi

if [ "${1:-}" = start ] || [ "${1:-}" = restart ]; then
    if [ "${STUB_SYSTEMCTL_FAIL_START:-}" = 1 ]; then
        echo "stub start failure" >&2
        exit 1
    fi
    if [ -n "${STUB_SYSTEMCTL_START_SPAWNS:-}" ]; then
        target="${STUB_SYSTEMCTL_TARGET:?STUB_SYSTEMCTL_TARGET is required}"
        if [ -n "${STUB_HEALTH_SERVER:-}" ]; then
            cp "${STUB_HEALTH_SERVER}" "$target/apps/api/dist/server.js"
        fi
        KANJISCRIBE_DATA_DIR="$target/data" \
        KANJISCRIBE_API_HOST=127.0.0.1 \
        KANJISCRIBE_API_PORT="${STUB_SYSTEMCTL_HEALTH_PORT:?STUB_SYSTEMCTL_HEALTH_PORT is required}" \
            node "$target/apps/api/dist/server.js" >/dev/null 2>&1 &
        printf '%s\n' "$!" >>"${SYSTEMCTL_PIDS}"
    fi
fi
EOF

cat >"$STUBBIN/curl" <<'EOF'
#!/bin/bash
if [ -n "${STUB_CURL_FAIL:-}" ]; then
    touch "${CURL_MARKER}"
    printf '503'
    exit 0
fi
exec /usr/bin/curl "$@"
EOF

cat >"$STUBBIN/sleep" <<'EOF'
#!/bin/bash
if [ -n "${STUB_SLEEP_NOOP:-}" ]; then
    exit 0
fi
exec /usr/bin/sleep "$@"
EOF

cat >"$STUBBIN/sudo" <<'EOF'
#!/bin/bash
if [ -n "${STUB_SUDO_POISON:-}" ]; then
    touch "${SUDO_MARKER}"
    echo "sudo was invoked: $*" >&2
    exit 99
fi
exec /usr/bin/sudo "$@"
EOF

HEALTH_SERVER="$STUBBIN/health-server.js"
cat >"$HEALTH_SERVER" <<'EOF'
import http from 'node:http';

const port = Number(process.env.KANJISCRIBE_API_PORT);
const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"ok":true}');
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(port, '127.0.0.1');
EOF
export STUB_HEALTH_SERVER="$HEALTH_SERVER"

cat >"$STUBBIN/pnpm" <<'EOF'
#!/bin/bash
# Poison stub: the build script is stubbed via KANJISCRIBE_BUILD_SCRIPT, so
# pnpm (the real build's toolchain) must never run. Any invocation fails.
touch "${PNPM_MARKER}"
echo "pnpm was invoked: $*" >&2
exit 99
EOF

cat >"$STUBBIN/date" <<'EOF'
#!/bin/bash
# Deterministic fake date while FAKE_DATE_FILE is exported; otherwise the real
# date. Each invocation increments the counter, so timestamps are distinct and
# monotonic (tests also unset FAKE_DATE_FILE to exercise the real-date path).
if [ -n "${FAKE_DATE_FILE:-}" ] && [ -e "${FAKE_DATE_FILE}" ]; then
    n="$(cat "${FAKE_DATE_FILE}" 2>/dev/null || printf '0')"
    n=$((n + 1))
    printf '%s' "$n" >"${FAKE_DATE_FILE}"
    printf '20260814-10%02d00' "$n"
else
    exec /usr/bin/date "$@"
fi
EOF

cat >"$STUBBIN/id" <<'EOF'
#!/bin/bash
# Pass-through id; with STUB_ID_UID exported, an 'id -u' call reports that
# value (faking a non-root run for the ownership tests).
if [ -n "${STUB_ID_UID:-}" ] && [ "$1" = "-u" ]; then
    printf '%s\n' "${STUB_ID_UID}"
    exit 0
fi
exec /usr/bin/id "$@"
EOF

cat >"$STUBBIN/chown" <<'EOF'
#!/bin/bash
# Pass-through chown; with STUB_CHOWN_POISON exported, any invocation records
# a marker and exits 99 — ownership tests assert the marker never appears.
if [ -n "${STUB_CHOWN_POISON:-}" ]; then
    touch "${STUB_CHOWN_MARKER}"
    echo "chown was invoked: $*" >&2
    exit 99
fi
exec /usr/bin/chown "$@"
EOF

chmod +x "$STUBBIN/npm" "$STUBBIN/systemctl" "$STUBBIN/curl" "$STUBBIN/sleep" \
    "$STUBBIN/sudo" "$STUBBIN/pnpm" "$STUBBIN/date" \
    "$STUBBIN/id" "$STUBBIN/chown"

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

# Build a throwaway instance fixture at <parent>/<name> and echo its path.
make_instance() {
    local dir="$1/$2"
    mkdir -p "$dir/apps/api/dist" "$dir/apps/web/dist" "$dir/systemd" \
        "$dir/docs" "$dir/data/kanji-svg"
    cat >"$dir/apps/api/dist/server.js" <<'EOF'
console.log("fixture server v1");
EOF
    cat >"$dir/apps/web/dist/index.html" <<'EOF'
<html><body>fixture web v1</body></html>
EOF
    echo "# fixture systemd unit" >"$dir/systemd/kanjiscribe.service"
    echo "fixture docs v1" >"$dir/docs/deployment.md"
    echo "fixture-db-v1" >"$dir/data/kanjiscribe.db"
    echo "<svg id='fixture-v1'/>" >"$dir/data/kanji-svg/04e00.svg"
    printf '%s\n' "$dir"
}

# Echo the full paths of managed siblings of the given <kind> ("release" or
# "failed") for an instance (strict anchored naming — mirrors what the script
# itself matches: literal prefix + a strictly numeric timestamp suffix, so
# foreign dirs can never match).
managed_sibling_paths() {
    local inst="$1" kind="$2" parent base f n prefix suffix
    parent="$(dirname "$inst")"
    base="$(basename "$inst")"
    prefix="${base}-${kind}-"
    for f in "$parent"/*; do
        [ -e "$f" ] || continue
        n="$(basename "$f")"
        [[ "$n" == "${prefix}"* ]] || continue
        suffix="${n#"$prefix"}"
        if [[ "$suffix" =~ ^${TS_RE}$ ]]; then
            printf '%s\n' "$f"
        fi
    done
}

release_backup_paths() { managed_sibling_paths "$1" release; }
failed_instance_paths() { managed_sibling_paths "$1" failed; }

# ---------------------------------------------------------------------------
# Issue 04: build stubs
# ---------------------------------------------------------------------------

# Write a stub build script at <path> that records every invocation in <log>
# and either exits 1 (fail=1: the build-failure path) or writes the fresh
# marker artifact into the dev repo's apps/api/dist and succeeds. The marker
# path is baked into the stub; cleanup_sandboxes removes it on every exit.
# Tests point the release script at the stub via the KANJISCRIBE_BUILD_SCRIPT
# seam (the PRD's "environment as the test knob" for the build phase).
make_build_stub() {
    local stub="$1" log="$2" fail="${3:-0}"
    if [ "$fail" -eq 1 ]; then
        cat >"$stub" <<EOF
#!/bin/bash
printf 'invoked\n' >>"$log"
echo "stub build failing as scripted" >&2
exit 1
EOF
    else
        cat >"$stub" <<EOF
#!/bin/bash
printf 'invoked\n' >>"$log"
mkdir -p "$REPO_ROOT/apps/api/dist"
echo "issue04-build-marker" >"${BUILD_MARKER}"
exit 0
EOF
    fi
    chmod +x "$stub"
}

# The default build stub (the KANJISCRIBE_BUILD_SCRIPT seam, issue 04): the
# same success stub make_build_stub writes for the build-behavior tests,
# logging to the shared STUB_BUILD_LOG.
make_build_stub "$STUBBIN/build-prod.sh" "$STUB_BUILD_LOG" 0

# ---------------------------------------------------------------------------
# Script runner
# ---------------------------------------------------------------------------

# Run the release script with the given args, capturing stdout/stderr/exit.
# Sets RUN_RC, RUN_STDOUT, RUN_STDERR and RUN_OUT (stdout+stderr merged).
run_script() {
    local tmp_out tmp_err
    tmp_out="$(mktemp)" || die "mktemp failed"
    tmp_err="$(mktemp)" || die "mktemp failed"
    RUN_RC=0
    bash "$RELEASE_SCRIPT" "$@" >"$tmp_out" 2>"$tmp_err" || RUN_RC=$?
    RUN_STDOUT="$(cat "$tmp_out")"
    RUN_STDERR="$(cat "$tmp_err")"
    RUN_OUT="$(cat "$tmp_out" "$tmp_err")"
    rm -f -- "$tmp_out" "$tmp_err"
}

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

test_usage_no_subcommand() {
    run_script
    assert_eq 1 "$RUN_RC" "bare invocation is a usage error"
    run_script --help
    assert_eq 0 "$RUN_RC" "--help exits 0"
    assert_matches "$RUN_OUT" 'fresh install' "--help documents the fresh-install path"
    assert_matches "$RUN_OUT" --service "--help documents the service flag"
    assert_matches "$RUN_OUT" --health-port "--help documents the health-port flag"
    assert_matches "$RUN_OUT" --no-auto-rollback "--help documents the rollback flag"
}

test_usage_unknown_subcommand() {
    run_script frobnicate /tmp
    assert_eq 1 "$RUN_RC" "unknown subcommand"
}

test_usage_missing_and_extra_args() {
    run_script release
    assert_eq 1 "$RUN_RC" "release without a target"

    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    run_script release "$inst" extra-arg
    assert_eq 1 "$RUN_RC" "release with an extra argument"

    run_script release "$inst" --bogus
    assert_eq 1 "$RUN_RC" "release with an unknown flag"

    run_script rollback
    assert_eq 1 "$RUN_RC" "rollback without a target"

    run_script list
    assert_eq 1 "$RUN_RC" "list without a target"

    run_script rollback "$inst" another
    assert_eq 1 "$RUN_RC" "rollback with an extra argument"
}

test_guard_missing_target() {
    sb="$(new_sandbox)"
    # Issue 05: a nonexistent target is a valid fresh install for release (the
    # fresh path is covered by the issue-05 tests below), so this guard now
    # applies to rollback and list only.
    run_script rollback "$sb/does-not-exist"
    assert_eq 2 "$RUN_RC" "rollback on a missing target is a guard failure"
    assert_matches "$RUN_OUT" 'does not exist' "clear error message"
    run_script list "$sb/does-not-exist"
    assert_eq 2 "$RUN_RC" "list on a missing target is a guard failure"
    assert_not_exists "$sb/does-not-exist.staging" "no staging created"
}

test_guard_non_instance_target() {
    sb="$(new_sandbox)"
    mkdir -p "$sb/empty-dir"
    run_script release "$sb/empty-dir"
    assert_eq 2 "$RUN_RC" "empty dir is not an instance"
    assert_matches "$RUN_OUT" 'does not look like a KanjiScribe instance'
    assert_not_exists "$sb/empty-dir.staging" "no staging created"

    mkdir -p "$sb/half-instance/apps/api/dist"
    echo "x" >"$sb/half-instance/apps/api/dist/server.js"
    run_script release "$sb/half-instance"
    assert_eq 2 "$RUN_RC" "missing systemd unit is a guard failure"
    assert_not_exists "$sb/half-instance.staging" "no staging created"

    mkdir -p "$sb/other-half/systemd"
    echo "x" >"$sb/other-half/systemd/kanjiscribe.service"
    run_script release "$sb/other-half"
    assert_eq 2 "$RUN_RC" "missing bundled server is a guard failure"
    assert_not_exists "$sb/other-half.staging" "no staging created"
}

test_guard_dev_repository_root() {
    run_script release "$REPO_ROOT"
    assert_eq 2 "$RUN_RC" "dev repository root refused for release"
    assert_matches "$RUN_OUT" 'repository' "error names the repository"
    assert_not_exists "$REPO_ROOT.staging" "never creates staging next to the repo root"

    run_script rollback "$REPO_ROOT"
    assert_eq 2 "$RUN_RC" "dev repository root refused for rollback"
    run_script list "$REPO_ROOT"
    assert_eq 2 "$RUN_RC" "dev repository root refused for list"
}

test_release_stale_staging_abort_and_force() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    mkdir -p "$inst.staging"
    echo "stale-marker" >"$inst.staging/marker.txt"

    run_script release "$inst" --no-build --skip-service
    assert_eq 2 "$RUN_RC" "stale staging aborts the release"
    assert_matches "$RUN_OUT" 'stale staging' "clear stale-staging message"
    assert_exists "$inst.staging/marker.txt" "stale staging left untouched"
    assert_eq 0 "$(release_backup_paths "$inst" | wc -l)" "no backup created on abort"

    run_script release "$inst" --no-build --skip-service --force
    assert_eq 0 "$RUN_RC" "--force removes stale staging and proceeds"
    assert_matches "$RUN_OUT" 'removing stale staging'
    assert_not_exists "$inst.staging" "staging consumed by the swap"
    assert_exists "$inst/apps/api/dist/server.js" "new instance is live"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "exactly one release backup"
    assert_eq 'console.log("fixture server v1");' "$(cat "$(release_backup_paths "$inst" | head -n1)/apps/api/dist/server.js")" \
        "backup holds the old instance"
}

test_release_success_end_to_end() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    ino_before="$(stat -c %i "$inst")"
    : >"$STUB_NPM_LOG"
    rm -f -- "$SYSTEMCTL_MARKER" "$PNPM_MARKER"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "release succeeds"
    assert_matches "$RUN_OUT" '\[ok\] release complete'

    # --- the release backup is a rename of the old live instance (no copy) ---
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "exactly one release backup"
    backup="$(release_backup_paths "$inst" | head -n1)"
    assert_matches "$(basename "$backup")" "$RELEASE_BACKUP_NAME_RE" "backup naming pattern"
    assert_eq "$ino_before" "$(stat -c %i "$backup")" "backup is the renamed live directory (same inode)"
    assert_eq 'console.log("fixture server v1");' "$(cat "$backup/apps/api/dist/server.js")" "backup holds the old code"
    assert_eq "<html><body>fixture web v1</body></html>" "$(cat "$backup/apps/web/dist/index.html")" "backup holds the old frontend"
    assert_eq "fixture-db-v1" "$(cat "$backup/data/kanjiscribe.db")" "backup holds the old data"
    assert_eq "fixture docs v1" "$(cat "$backup/docs/deployment.md")" "backup holds the old docs"
    assert_not_exists "$inst.staging" "staging consumed, not left behind"

    # --- the new instance is complete and self-contained ---
    assert_exists "$inst/apps/api/dist/server.js" "bundled server staged"
    assert_exists "$inst/apps/web/dist/index.html" "frontend staged"
    assert_exists "$inst/systemd/kanjiscribe.service" "systemd unit staged"
    assert_exists "$inst/docs/deployment.md" "docs staged"
    assert_exists "$inst/data/kanjiscribe.db" "data copied"
    assert_exists "$inst/data/kanji-svg/04e00.svg" "kanji-svg tree copied"
    assert_exists "$inst/apps/api/package.json" "minimal package.json staged"
    assert_matches "$(cat "$inst/apps/api/package.json")" '"better-sqlite3": "\^11\.8\.1"' \
        "package.json pins the native dependency"
    assert_eq "$(cat "$REPO_ROOT/apps/api/dist/server.js")" "$(cat "$inst/apps/api/dist/server.js")" \
        "live server comes from the dev repo's prebuilt bundle (no build ran)"

    # --- data comes exclusively from the live instance, never the dev repo ---
    assert_eq "fixture-db-v1" "$(cat "$inst/data/kanjiscribe.db")" \
        "live data is the fixture data, not the dev repository's"

    # --- native dependency install ran inside staging with the right args ---
    assert_eq 1 "$(grep -c '|npm|' "$STUB_NPM_LOG")" "npm ran exactly once"
    npm_line="$(tail -n1 "$STUB_NPM_LOG")"
    assert_eq "$inst.staging/apps/api" "$(printf '%s' "$npm_line" | cut -d'|' -f1)" \
        "npm ran inside the staging apps/api directory"
    assert_matches "$npm_line" 'install --omit=dev --no-package-lock' "exact npm install args"

    # --- this slice never touches systemctl or the build tool ---
    assert_not_exists "$SYSTEMCTL_MARKER" "systemctl never invoked"
    assert_not_exists "$PNPM_MARKER" "build tool never invoked"
}

test_service_mode_release_stops_starts_and_verifies_real_health() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    : >"$SYSTEMCTL_LOG"
    : >"$SYSTEMCTL_PIDS"
    export STUB_SYSTEMCTL_TARGET="$inst"
    export STUB_SYSTEMCTL_HEALTH_PORT=52655
    export STUB_SYSTEMCTL_START_SPAWNS=1

    run_script release "$inst" --no-build --health-port 52655
    assert_eq 0 "$RUN_RC" "service-mode release succeeds after real health check"
    assert_matches "$RUN_OUT" 'health verification succeeded' "health success is reported"
    assert_eq 'stop kanjiscribe' "$(sed -n '1p' "$SYSTEMCTL_LOG")" "service stops first"
    assert_eq 'start kanjiscribe' "$(sed -n '2p' "$SYSTEMCTL_LOG")" "service starts after the swap"
    stop_line="$(printf '%s\n' "$RUN_OUT" | grep -n '\[service\] stopping service' | cut -d: -f1)"
    copy_line="$(printf '%s\n' "$RUN_OUT" | grep -n '\[data\] copying live data' | cut -d: -f1)"
    swap_line="$(printf '%s\n' "$RUN_OUT" | grep -n '\[swap\] staging -> live' | cut -d: -f1)"
    start_line="$(printf '%s\n' "$RUN_OUT" | grep -n '\[service\] starting service' | cut -d: -f1)"
    [ "$stop_line" -lt "$copy_line" ] || die "service stop was not before the data copy"
    [ "$start_line" -gt "$swap_line" ] || die "service start was not after swap"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "normal release backup retention applies"
    assert_not_exists "$CURL_MARKER" "successful health used the real curl path"
}

test_service_stop_failure_aborts_before_data_copy_or_swap() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    live_ino="$(stat -c %i "$inst")"
    : >"$SYSTEMCTL_LOG"
    export STUB_SYSTEMCTL_FAIL_STOP=1

    run_script release "$inst" --no-build
    assert_eq 4 "$RUN_RC" "stop failure uses EXIT_STOP"
    assert_matches "$RUN_OUT" 'could not stop service' "stop failure is clear"
    assert_not_exists "$inst.staging" "staging is cleaned after stop failure"
    assert_eq 0 "$(release_backup_paths "$inst" | wc -l)" "no release backup was created"
    assert_eq "$live_ino" "$(stat -c %i "$inst")" "live instance was untouched"
    assert_eq 0 "$(printf '%s\n' "$RUN_OUT" | grep -c '\[data\]')" "data copy did not run"
    assert_eq 'stop kanjiscribe' "$(sed -n '1p' "$SYSTEMCTL_LOG")" "stop was attempted"
}

test_service_start_failure_uses_verification_rollback_path() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    export STUB_SYSTEMCTL_FAIL_START=1
    rm -f -- "$CURL_MARKER"

    run_script release "$inst" --no-build
    assert_eq 6 "$RUN_RC" "start failure uses EXIT_VERIFY"
    assert_matches "$RUN_OUT" 'could not start service' "start failure is clear"
    assert_eq 'fixture-db-v1' "$(cat "$inst/data/kanjiscribe.db")" "start failure restores the prior live instance"
    assert_eq 1 "$(failed_instance_paths "$inst" | wc -l)" "failed release is retained after start failure"
    assert_eq 1 "$(grep -c '^restart kanjiscribe$' "$SYSTEMCTL_LOG")" "rollback restart is attempted"
    assert_not_exists "$CURL_MARKER" "start failure does not poll a service that never started"
}

test_health_failure_auto_rolls_back_and_retains_one_failed_instance() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    mkdir -p "$sb/kanjiscribe-manual-backup" "$sb/junk"
    echo manual >"$sb/kanjiscribe-manual-backup/marker"
    echo junk >"$sb/junk/marker"
    export STUB_SYSTEMCTL_TARGET="$inst"
    export STUB_SYSTEMCTL_HEALTH_PORT=52656
    export STUB_CURL_FAIL=1
    export STUB_SLEEP_NOOP=1
    : >"$SYSTEMCTL_LOG"
    : >"$CURL_MARKER"

    run_script release "$inst" --no-build --health-port 52656
    assert_eq 6 "$RUN_RC" "health failure uses EXIT_VERIFY"
    assert_matches "$RUN_OUT" 'automatic rollback restored the previous instance' "auto-rollback success is reported"
    assert_eq 'fixture-db-v1' "$(cat "$inst/data/kanjiscribe.db")" "pre-release data is restored live"
    assert_eq 1 "$(failed_instance_paths "$inst" | wc -l)" "one failed instance is retained"
    first_failed="$(failed_instance_paths "$inst" | head -n1)"
    assert_matches "$(basename "$first_failed")" "$FAILED_INSTANCE_NAME_RE" "failed instance naming"
    assert_exists "$first_failed/apps/api/dist/server.js" "failed instance is kept whole"
    assert_eq 1 "$(grep -c '^restart kanjiscribe$' "$SYSTEMCTL_LOG")" "service restarted after first rollback"
    assert_exists "$sb/kanjiscribe-manual-backup/marker" "foreign manual backup survives failed pruning"
    assert_exists "$sb/junk/marker" "foreign junk survives failed pruning"

    run_script release "$inst" --no-build --health-port 52656
    assert_eq 6 "$RUN_RC" "second health failure uses EXIT_VERIFY"
    assert_eq 2 "$(grep -c '^restart kanjiscribe$' "$SYSTEMCTL_LOG")" "service restarted after both rollbacks"
    assert_eq 1 "$(failed_instance_paths "$inst" | wc -l)" "only newest failed instance remains"
    assert_not_exists "$first_failed" "older failed instance was pruned"
    assert_exists "$sb/kanjiscribe-manual-backup/marker" "manual backup survives second prune"
    assert_exists "$sb/junk/marker" "junk survives second prune"
}

test_list_marks_failed_instances() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    export STUB_SYSTEMCTL_TARGET="$inst"
    export STUB_SYSTEMCTL_HEALTH_PORT=52661
    export STUB_CURL_FAIL=1
    export STUB_SLEEP_NOOP=1

    # Produce one failed instance via auto-rollback. The rollback consumed
    # the pre-release backup (it renames back into the live slot), so only
    # the failed sibling remains.
    run_script release "$inst" --no-build --health-port 52661
    assert_eq 6 "$RUN_RC" "release fails verification and rolls back"
    assert_eq 1 "$(failed_instance_paths "$inst" | wc -l)" "one failed instance exists"
    assert_eq 0 "$(release_backup_paths "$inst" | wc -l)" "the rollback consumed the release backup"

    run_script list "$inst"
    assert_eq 0 "$RUN_RC" "list succeeds"
    failed_line="$(printf '%s\n' "$RUN_STDOUT" | grep -E "$LIST_FAILED_LINE_RE")"
    assert_eq 1 "$(printf '%s\n' "$failed_line" | wc -l)" "failed instance listed and marked 'failed'"
    assert_eq 0 "$(printf '%s\n' "$RUN_STDOUT" | grep -c "${TAB}release\$")" "no release rows when none exist"
    assert_eq "$(failed_instance_paths "$inst" | head -n1)" "$sb/$(printf '%s\n' "$failed_line" | cut -f1)" \
        "the listed failed name is the real failed sibling"
}

test_no_auto_rollback_leaves_failed_release_live() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    export STUB_SYSTEMCTL_TARGET="$inst"
    export STUB_SYSTEMCTL_HEALTH_PORT=52657
    export STUB_CURL_FAIL=1
    export STUB_SLEEP_NOOP=1

    run_script release "$inst" --no-build --health-port 52657 --no-auto-rollback
    assert_eq 6 "$RUN_RC" "disabled auto-rollback still fails verification"
    assert_matches "$RUN_OUT" 'run: .* rollback ' "manual rollback command is printed"
    assert_eq 0 "$(failed_instance_paths "$inst" | wc -l)" "no failed sibling is created"
    assert_not_exists "$inst/apps/api/dist/.release-test-build-marker" "live release remains the prebuilt release"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "pre-release backup remains available"
}

test_service_flag_is_passed_to_systemctl() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    export STUB_SYSTEMCTL_TARGET="$inst"
    export STUB_SYSTEMCTL_HEALTH_PORT=52658
    export STUB_SYSTEMCTL_START_SPAWNS=1
    : >"$SYSTEMCTL_LOG"

    run_script release "$inst" --no-build --service kanjiscribe-test --health-port 52658
    assert_eq 0 "$RUN_RC" "custom service release succeeds"
    assert_eq 'stop kanjiscribe-test' "$(sed -n '1p' "$SYSTEMCTL_LOG")" "custom service stop name"
    assert_eq 'start kanjiscribe-test' "$(sed -n '2p' "$SYSTEMCTL_LOG")" "custom service start name"
}

test_root_service_control_does_not_use_sudo() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    export STUB_SYSTEMCTL_TARGET="$inst"
    export STUB_SYSTEMCTL_HEALTH_PORT=52659
    export STUB_SYSTEMCTL_START_SPAWNS=1
    export STUB_SUDO_POISON=1
    rm -f -- "$SUDO_MARKER"

    run_script release "$inst" --no-build --health-port 52659
    assert_eq 0 "$RUN_RC" "root service release succeeds"
    assert_not_exists "$SUDO_MARKER" "root invokes systemctl without sudo"
}

test_fresh_service_stop_unit_not_loaded_is_non_fatal() {
    sb="$(new_sandbox)"
    target="$sb/kanjiscribe"
    export STUB_SYSTEMCTL_TARGET="$target"
    export STUB_SYSTEMCTL_HEALTH_PORT=52660
    export STUB_SYSTEMCTL_FAIL_STOP=unit-not-loaded
    export STUB_SYSTEMCTL_START_SPAWNS=1

    run_script release "$target" --no-build --health-port 52660
    assert_eq 0 "$RUN_RC" "fresh install tolerates an unregistered service unit"
    assert_matches "$RUN_OUT" 'not registered yet' "fresh-install stop decision is documented in output"
    assert_exists "$target" "fresh target was installed"
    assert_eq 0 "$(release_backup_paths "$target" | wc -l)" "fresh install has no release backup"
}

test_release_with_skip_service_is_silent() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    rm -f -- "$SYSTEMCTL_MARKER" "$CURL_MARKER"

    run_script release "$inst" --skip-service
    assert_eq 0 "$RUN_RC" "skip-service release works without service management"
    assert_not_exists "$SYSTEMCTL_MARKER" "systemctl never invoked"
    assert_not_exists "$CURL_MARKER" "skip-service never polls health"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "release backup created"
}

test_release_wal_sidecar_warning() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    echo "wal-bytes" >"$inst/data/kanjiscribe.db-wal"
    echo "shm-bytes" >"$inst/data/kanjiscribe.db-shm"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "release with WAL sidecars succeeds"
    assert_matches "$RUN_STDERR" 'WARNING' "WARNING goes to stderr"
    assert_matches "$RUN_STDERR" 'WAL sidecar' "warning names the WAL sidecars"
    assert_matches "$RUN_STDERR" 'kanjiscribe.db-wal' "warning names db-wal"
    assert_matches "$RUN_STDERR" 'kanjiscribe.db-shm' "warning names db-shm"
    assert_exists "$inst/data/kanjiscribe.db-wal" "sidecar copied into the new live instance, not dropped"
    assert_exists "$inst/data/kanjiscribe.db-shm" "second sidecar copied, not dropped"
    assert_eq "wal-bytes" "$(cat "$inst/data/kanjiscribe.db-wal")" "sidecar content preserved"
    backup="$(release_backup_paths "$inst" | head -n1)"
    assert_exists "$backup/data/kanjiscribe.db-wal" "backup retains the sidecars too"
}

test_release_data_copy_failure_exit_5() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    rm -rf -- "$inst/data"
    echo "not-a-directory" >"$inst/data"

    run_script release "$inst" --no-build --skip-service
    assert_eq 5 "$RUN_RC" "data copy failure exits with the data-copy code"
    assert_matches "$RUN_OUT" '\[error\]' "error is reported"
    assert_eq 0 "$(release_backup_paths "$inst" | wc -l)" "no backup created"
    assert_not_exists "$inst.staging" "staging cleaned up on abort"
    assert_exists "$inst/apps/api/dist/server.js" "live instance untouched"
    assert_eq "not-a-directory" "$(cat "$inst/data")" "live data untouched"
}

test_rollback_full_restore() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "release before rollback"
    backup_before="$(release_backup_paths "$inst" | head -n1)"
    backup_ino="$(stat -c %i "$backup_before")"

    # Mutate the live instance post-release to simulate newer live state.
    echo "post-release db change" >"$inst/data/kanjiscribe.db"
    echo "post-release code" >>"$inst/apps/api/dist/server.js"

    run_script rollback "$inst"
    assert_eq 0 "$RUN_RC" "rollback succeeds"
    assert_matches "$RUN_OUT" '\[ok\] rollback complete'

    # Full restore: code and data are the pre-release versions again.
    assert_eq "fixture-db-v1" "$(cat "$inst/data/kanjiscribe.db")" "data fully restored"
    assert_eq 'console.log("fixture server v1");' "$(cat "$inst/apps/api/dist/server.js")" \
        "code fully restored (post-release mutation gone)"
    assert_not_exists "$backup_before" "the restored backup was renamed into the live slot"
    assert_eq "$backup_ino" "$(stat -c %i "$inst")" "rollback is a rename swap of the backup (same inode)"

    # The rolled-back instance is preserved as the (single) release backup:
    # the restored backup became live, so only the moved-aside instance remains.
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "one release backup remains after rollback"
    aside="$(release_backup_paths "$inst" | head -n1)"
    assert_matches "$(cat "$aside/data/kanjiscribe.db")" 'post-release' "rolled-back instance preserved aside"
}

test_rollback_no_backups() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    run_script rollback "$inst"
    assert_eq 2 "$RUN_RC" "rollback with no backups is refused"
    assert_matches "$RUN_OUT" 'no release backups' "clear no-backup message"
    assert_exists "$inst/apps/api/dist/server.js" "live instance untouched"
    assert_eq 0 "$(release_backup_paths "$inst" | wc -l)" "nothing created"
}

test_list_backups() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    run_script list "$inst"
    assert_eq 0 "$RUN_RC" "list on a fresh instance succeeds"
    assert_matches "$RUN_OUT" 'no release backups' "empty list message"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "first release"
    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "second release"

    run_script list "$inst"
    assert_eq 0 "$RUN_RC" "list after two releases"
    lines="$(printf '%s\n' "$RUN_STDOUT" | grep -E "$LIST_RELEASE_LINE_RE")"
    assert_eq 2 "$(printf '%s\n' "$lines" | wc -l)" "two release backup lines with timestamps and kind"
    assert_eq 0 "$(printf '%s\n' "$RUN_STDOUT" | grep -c "${TAB}failed\$")" "no failed-instance rows"
    first_ts="$(printf '%s\n' "$lines" | head -n1 | cut -f2)"
    second_ts="$(printf '%s\n' "$lines" | sed -n '2p' | cut -f2)"
    [ "$first_ts" \> "$second_ts" ] || die "list output is not newest-first"
}

test_foreign_dirs_never_matched() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    # Legacy and near-miss siblings: none may ever match the script's patterns.
    mkdir -p "$sb/kanjiscribe-manual-backup"
    echo "legacy" >"$sb/kanjiscribe-manual-backup/marker"
    mkdir -p "$sb/kanjiscribe-release-not-a-date"
    mkdir -p "$sb/kanjiscribe-release-1234567-123456"
    mkdir -p "$sb/xkanjiscribe-release-20260814-101500"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "release succeeds despite foreign siblings"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "only the real backup matches the pattern"

    run_script list "$inst"
    assert_eq 1 "$(printf '%s\n' "$RUN_STDOUT" | grep -cE "kanjiscribe-release-${TS_RE}${TAB}")" \
        "foreign dirs are never listed"
    assert_matches "$RUN_STDOUT" "$LIST_RELEASE_LINE_RE" \
        "list output is exactly one valid line"

    run_script rollback "$inst"
    assert_eq 0 "$RUN_RC" "rollback selects the real backup"
    assert_eq "fixture-db-v1" "$(cat "$inst/data/kanjiscribe.db")" "rollback restored the fixture data"
    assert_exists "$sb/kanjiscribe-manual-backup/marker" "legacy dir never touched"
}

test_real_date_naming() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    # Exercise the real date path: with FAKE_DATE_FILE unset, the stub date
    # falls through to /usr/bin/date.
    unset FAKE_DATE_FILE
    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "release with the real date"
    backup="$(release_backup_paths "$inst" | head -n1)"
    assert_matches "$(basename "$backup")" "$RELEASE_BACKUP_NAME_RE" \
        "real timestamp still matches the naming pattern"
}

# ---------------------------------------------------------------------------
# Issue 02: retention pruning and rollback selection
# ---------------------------------------------------------------------------

test_retention_prune_to_three() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    ts_list=""
    for i in 1 2 3 4 5; do
        run_script release "$inst" --no-build --skip-service
        assert_eq 0 "$RUN_RC" "release $i succeeds"
        if [ "$i" -ge 4 ]; then
            assert_matches "$RUN_OUT" '\[retention\] pruning release backup' \
                "release $i prunes an older backup"
        fi
        run_script list "$inst"
        newest_ts="$(printf '%s\n' "$RUN_STDOUT" | head -n1 | cut -f2)"
        if [ -z "$ts_list" ]; then
            ts_list="$newest_ts"
        else
            ts_list="${ts_list}
${newest_ts}"
        fi
        if [ "$i" -eq 4 ]; then
            t1="$(printf '%s\n' "$ts_list" | sed -n '1p')"
            assert_eq 3 "$(release_backup_paths "$inst" | wc -l)" "pruned to 3 right after release 4"
            assert_not_exists "$sb/kanjiscribe-release-$t1" "oldest backup pruned by release 4"
        fi
    done
    t1="$(printf '%s\n' "$ts_list" | sed -n '1p')"
    t2="$(printf '%s\n' "$ts_list" | sed -n '2p')"
    t3="$(printf '%s\n' "$ts_list" | sed -n '3p')"
    t4="$(printf '%s\n' "$ts_list" | sed -n '4p')"
    t5="$(printf '%s\n' "$ts_list" | sed -n '5p')"
    assert_eq 5 "$(printf '%s\n' "$ts_list" | wc -l)" "five distinct timestamps recorded"

    assert_eq 3 "$(release_backup_paths "$inst" | wc -l)" "exactly 3 backups remain after 5 releases"
    assert_not_exists "$sb/kanjiscribe-release-$t1" "oldest backup pruned"
    assert_not_exists "$sb/kanjiscribe-release-$t2" "second-oldest backup pruned"
    assert_exists "$sb/kanjiscribe-release-$t3" "third-newest retained"
    assert_exists "$sb/kanjiscribe-release-$t4" "second-newest retained"
    assert_exists "$sb/kanjiscribe-release-$t5" "newest retained"

    # The retained backups are full directories (deletion removes the whole
    # backup directory when it prunes).
    assert_exists "$sb/kanjiscribe-release-$t3/data/kanjiscribe.db" "retained backup is intact"
}

test_keep_flag_override() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    run_script release "$inst" --no-build --skip-service --keep 1
    assert_eq 0 "$RUN_RC" "--keep 1 accepted on the first release"
    echo "db-v2" >"$inst/data/kanjiscribe.db"
    run_script release "$inst" --no-build --skip-service --keep 1
    assert_eq 0 "$RUN_RC" "second release with --keep 1"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "--keep 1 prunes after the second release"
    echo "db-v3" >"$inst/data/kanjiscribe.db"
    run_script release "$inst" --no-build --skip-service --keep 1
    assert_eq 0 "$RUN_RC" "third release with --keep 1"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "--keep 1 retains exactly one backup"
    survivor="$(release_backup_paths "$inst" | head -n1)"
    assert_eq "db-v3" "$(cat "$survivor/data/kanjiscribe.db")" "the retained backup is the newest"

    # Invalid --keep values are usage errors that change nothing.
    run_script release "$inst" --no-build --skip-service --keep 0
    assert_eq 1 "$RUN_RC" "--keep 0 is a usage error"
    assert_matches "$RUN_STDERR" 'positive integer' "--keep 0 names the requirement"
    run_script release "$inst" --no-build --skip-service --keep notanumber
    assert_eq 1 "$RUN_RC" "--keep notanumber is a usage error"
    run_script release "$inst" --no-build --skip-service --keep
    assert_eq 1 "$RUN_RC" "--keep without a value is a usage error"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "invalid --keep changed nothing"
}

test_foreign_dirs_survive_prune_and_rollback() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    mkdir -p "$sb/kanjiscribe-manual-backup"
    echo "legacy-content" >"$sb/kanjiscribe-manual-backup/marker"
    mkdir -p "$sb/junk-dir"
    echo "junk-content" >"$sb/junk-dir/marker"

    for i in 1 2 3 4 5; do
        run_script release "$inst" --no-build --skip-service
        assert_eq 0 "$RUN_RC" "release $i succeeds"
    done
    assert_eq 3 "$(release_backup_paths "$inst" | wc -l)" "retention pruned to 3"
    assert_exists "$sb/kanjiscribe-manual-backup/marker" "legacy dir survives releases and pruning"
    assert_eq "legacy-content" "$(cat "$sb/kanjiscribe-manual-backup/marker")" "legacy content unchanged"
    assert_exists "$sb/junk-dir/marker" "junk dir survives releases and pruning"
    assert_eq "junk-content" "$(cat "$sb/junk-dir/marker")" "junk content unchanged"

    run_script rollback "$inst"
    assert_eq 0 "$RUN_RC" "rollback succeeds"
    assert_exists "$sb/kanjiscribe-manual-backup/marker" "legacy dir survives rollback"
    assert_eq "legacy-content" "$(cat "$sb/kanjiscribe-manual-backup/marker")" "legacy content still unchanged"
    assert_exists "$sb/junk-dir/marker" "junk dir survives rollback"
    assert_eq "junk-content" "$(cat "$sb/junk-dir/marker")" "junk content still unchanged"

    run_script list "$inst"
    assert_eq 0 "$(printf '%s\n' "$RUN_STDOUT" | grep -c 'manual-backup')" "legacy dir never listed"
    assert_eq 0 "$(printf '%s\n' "$RUN_STDOUT" | grep -c 'junk-dir')" "junk dir never listed"
}

test_rollback_selected_backup() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "first release (data v1)"
    echo "db-v2" >"$inst/data/kanjiscribe.db"
    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "second release (data v2)"
    echo "db-v3" >"$inst/data/kanjiscribe.db"
    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "third release (data v3)"
    assert_eq 3 "$(release_backup_paths "$inst" | wc -l)" "three backups retained (default keep 3)"

    # The selector is read from list output — the same TS the operator passes
    # to --backup (list shows newest first, so line 2 is the middle backup).
    run_script list "$inst"
    assert_eq 0 "$RUN_RC" "list after three releases"
    middle_ts="$(printf '%s\n' "$RUN_STDOUT" | sed -n '2p' | cut -f2)"
    newest_ts="$(printf '%s\n' "$RUN_STDOUT" | head -n1 | cut -f2)"
    assert_eq "db-v2" "$(cat "$sb/kanjiscribe-release-$middle_ts/data/kanjiscribe.db")" \
        "middle backup holds v2"
    middle_ino="$(stat -c %i "$sb/kanjiscribe-release-$middle_ts")"
    newest_backup="$sb/kanjiscribe-release-$newest_ts"
    newest_ino="$(stat -c %i "$newest_backup")"

    run_script rollback "$inst" --backup "$middle_ts"
    assert_eq 0 "$RUN_RC" "selected rollback succeeds"
    assert_matches "$RUN_OUT" '\[ok\] rollback complete'
    assert_matches "$RUN_OUT" 'restoring selected release backup'

    assert_eq "db-v2" "$(cat "$inst/data/kanjiscribe.db")" "live data is the selected backup's data"
    assert_eq "$middle_ino" "$(stat -c %i "$inst")" "selected rollback is a rename swap (same inode)"
    assert_not_exists "$sb/kanjiscribe-release-$middle_ts" "selected backup renamed into the live slot"

    # The newest backup is untouched by the selected rollback.
    assert_exists "$newest_backup" "newest backup still exists"
    assert_eq "$newest_ino" "$(stat -c %i "$newest_backup")" "newest backup untouched (same inode)"
    assert_eq "db-v3" "$(cat "$newest_backup/data/kanjiscribe.db")" "newest backup still holds v3"

    # The moved-aside live instance became a new release backup: one out, one in.
    assert_eq 3 "$(release_backup_paths "$inst" | wc -l)" "backup count unchanged by the swap"
}

test_rollback_invalid_selector() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "release before invalid-selector attempts"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "one backup before"
    backup_before="$(release_backup_paths "$inst" | head -n1)"
    backup_before_ino="$(stat -c %i "$backup_before")"

    echo "live-marker" >"$inst/marker.txt"
    live_ino="$(stat -c %i "$inst")"

    run_script rollback "$inst" --backup bogus
    assert_eq 7 "$RUN_RC" "malformed selector exits EXIT_ROLLBACK"
    assert_matches "$RUN_STDERR" 'invalid backup selector' "clear error names the bad selector"

    run_script rollback "$inst" --backup 20260814-999999
    assert_eq 7 "$RUN_RC" "valid-format but unknown selector exits EXIT_ROLLBACK"
    assert_matches "$RUN_STDERR" 'no release backup with timestamp' "clear unknown-selector error"

    run_script rollback "$inst" --backup
    assert_eq 1 "$RUN_RC" "--backup without a value is a usage error"

    assert_eq "$live_ino" "$(stat -c %i "$inst")" "live dir untouched (same inode)"
    assert_eq "live-marker" "$(cat "$inst/marker.txt")" "live content untouched"
    assert_eq 1 "$(release_backup_paths "$inst" | wc -l)" "no backup created or removed"
    assert_eq "$backup_before_ino" "$(stat -c %i "$backup_before")" "existing backup untouched (same inode)"
}

# ---------------------------------------------------------------------------
# Issue 04: build integration and ownership
# ---------------------------------------------------------------------------

test_build_runs_by_default() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    build_stub="$sb/build-prod-stub.sh"
    build_log="$sb/build-invocations.log"
    make_build_stub "$build_stub" "$build_log" 0
    export KANJISCRIBE_BUILD_SCRIPT="$build_stub"

    run_script release "$inst" --skip-service
    assert_eq 0 "$RUN_RC" "release with the default build succeeds"
    assert_matches "$RUN_OUT" '\[build\]' "build phase is reported"
    assert_matches "$RUN_OUT" '\[ok\] release complete' "release completed"

    assert_eq 1 "$(wc -l <"$build_log")" "build script invoked exactly once"
    assert_exists "$inst/apps/api/dist/.release-test-build-marker" \
        "fresh build artifact staged into the live instance"
    assert_eq "issue04-build-marker" "$(cat "$inst/apps/api/dist/.release-test-build-marker")" \
        "fresh artifact content is the stub's build output"
}

test_no_build_skips_build() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    build_stub="$sb/build-poison.sh"
    build_log="$sb/build-invocations.log"
    make_build_stub "$build_stub" "$build_log" 1
    export KANJISCRIBE_BUILD_SCRIPT="$build_stub"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "--no-build release succeeds without building"
    assert_not_exists "$build_log" "build script never invoked"
    assert_not_exists "$inst/apps/api/dist/.release-test-build-marker" \
        "no fresh build artifact appears"
    assert_eq "$(cat "$REPO_ROOT/apps/api/dist/server.js")" "$(cat "$inst/apps/api/dist/server.js")" \
        "live server comes from the prebuilt bundle, not a build"
    assert_matches "$RUN_OUT" 'no-build mode' "no-build mode is reported"
}

test_build_failure_aborts_before_modification() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    live_ino="$(stat -c %i "$inst")"
    server_before="$(cat "$inst/apps/api/dist/server.js")"
    build_stub="$sb/build-fail.sh"
    build_log="$sb/build-invocations.log"
    make_build_stub "$build_stub" "$build_log" 1
    export KANJISCRIBE_BUILD_SCRIPT="$build_stub"

    run_script release "$inst" --skip-service
    assert_eq 3 "$RUN_RC" "build failure exits with EXIT_BUILD"
    assert_matches "$RUN_OUT" 'build failed' "clear build-failure error"
    assert_eq 1 "$(wc -l <"$build_log")" "build script was invoked once"
    assert_not_exists "$inst.staging" "no staging directory created"
    assert_eq 0 "$(release_backup_paths "$inst" | wc -l)" "no backups created"
    assert_eq "$live_ino" "$(stat -c %i "$inst")" "live directory untouched (same inode)"
    assert_eq "$server_before" "$(cat "$inst/apps/api/dist/server.js")" "live content untouched"
}

test_root_ownership_applied() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    build_stub="$sb/build-prod-stub.sh"
    build_log="$sb/build-invocations.log"
    make_build_stub "$build_stub" "$build_log" 0
    export KANJISCRIBE_BUILD_SCRIPT="$build_stub"
    export SUDO_USER=daemon

    run_script release "$inst" --skip-service
    assert_eq 0 "$RUN_RC" "release as root with SUDO_USER succeeds"

    # The swapped directories end up owned by the invoking user, not root.
    assert_eq "daemon" "$(stat -c %U "$inst")" "live directory owned by the invoking user"
    assert_eq "daemon" "$(stat -c %U "$inst/apps/api/dist/.release-test-build-marker")" \
        "staged build artifact owned by the invoking user"
    assert_eq "daemon" "$(stat -c %U "$inst/data/kanjiscribe.db")" \
        "copied data owned by the invoking user"
    backup="$(release_backup_paths "$inst" | head -n1)"
    assert_eq "daemon" "$(stat -c %U "$backup")" "release backup owned by the invoking user"
    assert_eq "daemon" "$(stat -c %U "$backup/data/kanjiscribe.db")" \
        "backup content owned by the invoking user"

    # Rollback restores ownership too: simulate a root-owned backup (e.g. a
    # legacy backup predating this script's ownership fix-up) and roll back.
    chown -R root:root "$backup"
    run_script rollback "$inst"
    assert_eq 0 "$RUN_RC" "rollback succeeds"
    assert_eq "daemon" "$(stat -c %U "$inst")" "restored live directory owned by the invoking user"
    assert_eq "daemon" "$(stat -c %U "$inst/data/kanjiscribe.db")" \
        "restored data owned by the invoking user"
}

test_non_root_skips_chown() {
    sb="$(new_sandbox)"
    inst="$(make_instance "$sb" kanjiscribe)"
    export STUB_ID_UID=1000
    export STUB_CHOWN_POISON=1
    export STUB_CHOWN_MARKER="$sb/chown-called"

    run_script release "$inst" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "release succeeds when not root"
    assert_not_exists "$STUB_CHOWN_MARKER" "chown never invoked when not root"
    assert_matches "$RUN_OUT" '\[ok\] release complete' "release completed"
}

# ---------------------------------------------------------------------------
# Issue 05: fresh install path
# ---------------------------------------------------------------------------

test_fresh_install_layout_no_siblings() {
    sb="$(new_sandbox)"
    target="$sb/kanjiscribe"
    assert_not_exists "$target" "target starts out nonexistent"
    rm -f -- "$SYSTEMCTL_MARKER" "$PNPM_MARKER"

    # Default build mode: the fresh path builds too, so the stub build's
    # marker artifact must land in the new instance.
    run_script release "$target" --skip-service
    assert_eq 0 "$RUN_RC" "fresh install succeeds"
    assert_matches "$RUN_OUT" 'fresh install' "the fresh-install path is reported"
    assert_matches "$RUN_OUT" '\[ok\] release complete' "release completed"

    # Complete instance layout.
    assert_exists "$target/apps/api/dist/server.js" "bundled server staged"
    assert_exists "$target/apps/api/dist/.release-test-build-marker" \
        "fresh build artifact staged (build ran by default)"
    assert_eq "issue04-build-marker" "$(cat "$target/apps/api/dist/.release-test-build-marker")" \
        "fresh artifact content is the stub's build output"
    assert_exists "$target/apps/web/dist/index.html" "frontend staged"
    assert_exists "$target/systemd/kanjiscribe.service" "systemd unit staged"
    assert_exists "$target/docs/deployment.md" "docs staged"
    assert_exists "$target/apps/api/package.json" "minimal package.json staged"
    assert_exists "$target/apps/api/node_modules/better-sqlite3/.stub-marker" \
        "native dependency installed (stub npm)"
    # The data directory is an empty skeleton: dataset import is manual.
    assert_exists "$target/data" "data directory skeleton exists"
    assert_eq "" "$(ls -A "$target/data")" "data directory is empty"

    # No release backup, failed instance, or staging sibling anywhere.
    for entry in "$sb"/*; do
        [ -e "$entry" ] || continue
        name="$(basename "$entry")"
        case "$name" in
        kanjiscribe-release-*) die "fresh install created a release-backup sibling: $name" ;;
        kanjiscribe-failed-*) die "fresh install created a failed-instance sibling: $name" ;;
        esac
    done
    assert_not_exists "$target.staging" "staging consumed by the rename"
    assert_not_exists "$SYSTEMCTL_MARKER" "systemctl never invoked"
    assert_not_exists "$PNPM_MARKER" "build tool never invoked"
}

test_fresh_instance_boots_standalone() {
    sb="$(new_sandbox)"
    target="$sb/kanjiscribe"

    run_script release "$target" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "fresh install succeeds"

    # Boots-standalone proof, matching how the issue-01 swap-path tests prove
    # it: the staged server is byte-identical to the dev repository's prebuilt
    # bundle — the exact artifact the systemd unit runs — sitting beside its
    # own empty data/ directory and its installed native dependency, so the
    # instance is a complete, self-contained unit.
    assert_exists "$target/apps/api/dist/server.js" "bundled server staged"
    assert_eq "$(cat "$REPO_ROOT/apps/api/dist/server.js")" "$(cat "$target/apps/api/dist/server.js")" \
        "staged server is the repo's prebuilt bundle (the artifact the service runs)"
    assert_exists "$target/apps/api/node_modules/better-sqlite3/.stub-marker" \
        "native dependency in place next to the server"
    assert_exists "$target/data" "the server's own data directory exists"
    assert_eq "" "$(ls -A "$target/data")" "its data directory starts empty"
    assert_exists "$target/systemd/kanjiscribe.service" "systemd unit staged"
    assert_exists "$target/docs/deployment.md" "docs staged"
}

test_fresh_then_normal_update() {
    sb="$(new_sandbox)"
    target="$sb/kanjiscribe"

    run_script release "$target" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "fresh install succeeds"
    assert_eq 0 "$(release_backup_paths "$target" | wc -l)" "no backup siblings after the fresh install"
    assert_not_exists "$target.staging" "no staging leftover"

    # Rollback/list against the fresh-installed target keep existing behavior.
    run_script rollback "$target"
    assert_eq 2 "$RUN_RC" "rollback with no backups is refused"
    assert_matches "$RUN_OUT" 'no release backups' "clear no-backup message"
    run_script list "$target"
    assert_eq 0 "$RUN_RC" "list succeeds"
    assert_matches "$RUN_OUT" 'no release backups' "empty list message"

    # A subsequent release is a normal update, not another fresh install.
    echo "db-v2" >"$target/data/kanjiscribe.db"
    run_script release "$target" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "second release (update) succeeds"
    assert_eq 0 "$(printf '%s' "$RUN_OUT" | grep -c 'fresh install')" \
        "the fresh path did not trigger again"
    assert_matches "$RUN_OUT" '\[ok\] previous instance preserved as release backup' \
        "the update reports its release backup"
    assert_eq 1 "$(release_backup_paths "$target" | wc -l)" \
        "exactly one release backup after the update"
    backup="$(release_backup_paths "$target" | head -n1)"
    assert_matches "$(basename "$backup")" "$RELEASE_BACKUP_NAME_RE" \
        "backup naming pattern"
    assert_eq "db-v2" "$(cat "$backup/data/kanjiscribe.db")" "backup holds the previous live data"
    assert_eq "$(cat "$REPO_ROOT/apps/api/dist/server.js")" "$(cat "$backup/apps/api/dist/server.js")" \
        "backup is the previous live instance (the fresh install's staged server)"
    assert_eq 0 "$(printf '%s' "$RUN_OUT" | grep -c 'pruning release backup:')" \
        "nothing pruned with one backup (default --keep 3)"
}

test_fresh_guards() {
    sb="$(new_sandbox)"

    # Missing target argument is a usage error (exit 1).
    run_script release
    assert_eq 1 "$RUN_RC" "release without a target is a usage error"

    # The dev repository root is refused (exit 2); it exists, so the
    # existing-target guard catches it before any fresh path would.
    run_script release "$REPO_ROOT"
    assert_eq 2 "$RUN_RC" "dev repository root refused"
    assert_matches "$RUN_OUT" 'repository' "error names the repository"

    # A nonexistent PARENT directory is a guard failure (exit 2): the fresh
    # install renames staging into the parent, so the parent must exist; the
    # script never creates parent directories.
    run_script release "$sb/no-such-parent/kanjiscribe"
    assert_eq 2 "$RUN_RC" "nonexistent parent is a guard failure"
    assert_matches "$RUN_OUT" 'parent directory does not exist' "clear parent error"
    assert_not_exists "$sb/no-such-parent" "no parent directory was created"

    # A stale staging sibling still aborts a fresh install unless --force.
    target="$sb/kanjiscribe"
    mkdir -p "$target.staging"
    echo "stale-marker" >"$target.staging/marker.txt"
    run_script release "$target" --no-build --skip-service
    assert_eq 2 "$RUN_RC" "stale staging aborts a fresh install"
    assert_matches "$RUN_OUT" 'stale staging' "clear stale-staging message"
    assert_exists "$target.staging/marker.txt" "stale staging left untouched"
    assert_not_exists "$target" "target still does not exist"

    run_script release "$target" --no-build --skip-service --force
    assert_eq 0 "$RUN_RC" "--force removes the stale staging and installs fresh"
    assert_matches "$RUN_OUT" 'removing stale staging' "stale staging removal reported"
    assert_exists "$target/apps/api/dist/server.js" "fresh instance in place"
    assert_not_exists "$target.staging" "staging consumed"

    # An existing non-directory target is neither an instance nor fresh.
    touch "$sb/afile"
    run_script release "$sb/afile"
    assert_eq 2 "$RUN_RC" "existing file target is a guard failure"
    assert_matches "$RUN_OUT" 'does not exist or is not a directory' "clear non-directory error"
}

test_fresh_no_build() {
    sb="$(new_sandbox)"
    target="$sb/kanjiscribe"
    build_stub="$sb/build-poison.sh"
    build_log="$sb/build-invocations.log"
    make_build_stub "$build_stub" "$build_log" 1
    export KANJISCRIBE_BUILD_SCRIPT="$build_stub"

    run_script release "$target" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "--no-build fresh install succeeds"
    assert_not_exists "$build_log" "build script never invoked"
    assert_not_exists "$target/apps/api/dist/.release-test-build-marker" \
        "no fresh build artifact appears"
    assert_exists "$target/apps/api/dist/server.js" "instance still complete"
    assert_eq "" "$(ls -A "$target/data")" "data skeleton empty"
    assert_eq 0 "$(release_backup_paths "$target" | wc -l)" "no backup siblings"
}

test_fresh_build_failure_aborts_clean() {
    sb="$(new_sandbox)"
    target="$sb/kanjiscribe"
    build_stub="$sb/build-fail.sh"
    build_log="$sb/build-invocations.log"
    make_build_stub "$build_stub" "$build_log" 1
    export KANJISCRIBE_BUILD_SCRIPT="$build_stub"

    run_script release "$target" --skip-service
    assert_eq 3 "$RUN_RC" "build failure on the fresh path exits EXIT_BUILD"
    assert_matches "$RUN_OUT" 'build failed' "clear build-failure error"
    assert_eq 1 "$(wc -l <"$build_log")" "build script invoked once"
    assert_not_exists "$target" "no partial target created"
    assert_not_exists "$target.staging" "no staging leftover"
    for entry in "$sb"/*; do
        [ -e "$entry" ] || continue
        name="$(basename "$entry")"
        case "$name" in
        kanjiscribe-release-* | kanjiscribe-failed-*) die "build failure left a sibling: $name" ;;
        esac
    done
}

test_fresh_ownership_applied() {
    sb="$(new_sandbox)"
    target="$sb/kanjiscribe"
    export SUDO_USER=daemon

    run_script release "$target" --no-build --skip-service
    assert_eq 0 "$RUN_RC" "fresh install as root with SUDO_USER succeeds"
    assert_eq "daemon" "$(stat -c %U "$target")" "fresh target owned by the invoking user"
    assert_eq "daemon" "$(stat -c %U "$target/apps/api/dist/server.js")" \
        "staged files owned by the invoking user"
    assert_eq "daemon" "$(stat -c %U "$target/data")" "data skeleton owned by the invoking user"
}

# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

run_test() {
    local name="$1"
    echo ""
    echo "=== $name ==="
    # Each test runs in a subshell with its own sandbox registry and EXIT
    # trap, so every fixture a test creates is cleaned up even on failure.
    if (set -e; SANDBOX_REGISTRY="$(mktemp)" || exit 1; trap cleanup_sandboxes EXIT; "$name"); then
        PASS=$((PASS + 1))
        echo "PASS: $name"
    else
        FAIL=$((FAIL + 1))
        FAILED_NAMES+=("$name")
        echo "FAIL: $name"
    fi
}

run_test test_usage_no_subcommand
run_test test_usage_unknown_subcommand
run_test test_usage_missing_and_extra_args
run_test test_guard_missing_target
run_test test_guard_non_instance_target
run_test test_guard_dev_repository_root
run_test test_release_stale_staging_abort_and_force
run_test test_release_success_end_to_end
run_test test_service_mode_release_stops_starts_and_verifies_real_health
run_test test_service_stop_failure_aborts_before_data_copy_or_swap
run_test test_service_start_failure_uses_verification_rollback_path
run_test test_health_failure_auto_rolls_back_and_retains_one_failed_instance
run_test test_list_marks_failed_instances
run_test test_no_auto_rollback_leaves_failed_release_live
run_test test_service_flag_is_passed_to_systemctl
run_test test_root_service_control_does_not_use_sudo
run_test test_fresh_service_stop_unit_not_loaded_is_non_fatal
run_test test_release_with_skip_service_is_silent
run_test test_release_wal_sidecar_warning
run_test test_release_data_copy_failure_exit_5
run_test test_rollback_full_restore
run_test test_rollback_no_backups
run_test test_list_backups
run_test test_foreign_dirs_never_matched
run_test test_real_date_naming
run_test test_retention_prune_to_three
run_test test_keep_flag_override
run_test test_foreign_dirs_survive_prune_and_rollback
run_test test_rollback_selected_backup
run_test test_rollback_invalid_selector
run_test test_build_runs_by_default
run_test test_no_build_skips_build
run_test test_build_failure_aborts_before_modification
run_test test_root_ownership_applied
run_test test_non_root_skips_chown
run_test test_fresh_install_layout_no_siblings
run_test test_fresh_instance_boots_standalone
run_test test_fresh_then_normal_update
run_test test_fresh_guards
run_test test_fresh_no_build
run_test test_fresh_build_failure_aborts_clean
run_test test_fresh_ownership_applied

echo ""
echo "============================================================"
echo "PASS: $PASS  FAIL: $FAIL"
if [ "$FAIL" -gt 0 ]; then
    printf 'Failed tests:\n'
    failed_name=
    for failed_name in "${FAILED_NAMES[@]}"; do
        printf '  - %s\n' "$failed_name"
    done
    exit 1
fi
echo "All tests passed."
exit 0
