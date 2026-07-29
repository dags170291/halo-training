#!/usr/bin/env bash
# Single-command test runner for HALO's whole tests/ suite (test_*.js). Replaces the old
# "loop through 3 hand-typed batches and grep for FAIL" workflow used every version bump — this is
# the same idea, wired into one script instead of retyped by hand each time, so it can also double
# as a real CI gate later if this project ever grows a git remote/GitHub Actions to run it in.
#
# Usage:
#   tests/run_all_tests.sh            # run every test_*.js
#   tests/run_all_tests.sh test_foo.js test_bar.js   # run just these files
#
# Exit code: 0 if every check across every file passed, 1 if anything failed or errored (so this is
# safe to use as a CI/pre-deploy gate, not just a human-readable report).

set -u
cd "$(dirname "${BASH_SOURCE[0]}")"

# Same jsdom setup every test file needs (see DEVELOPMENT.md §6) — installed automatically here
# instead of requiring a separate manual step first, since a fresh sandbox/CI runner won't have it.
if [ ! -d /tmp/node_modules/jsdom ]; then
  echo "Installing jsdom into /tmp/node_modules (one-time per fresh environment)..."
  mkdir -p /tmp/node_modules
  npm install jsdom --prefix /tmp --silent 2>&1 | tail -5
fi

FILES=("$@")
if [ ${#FILES[@]} -eq 0 ]; then
  FILES=(test_*.js)
fi

total_pass=0
total_fail=0
total_files=0
failed_files=()

for f in "${FILES[@]}"; do
  [ -f "$f" ] || { echo "Skipping $f (not found)"; continue; }
  total_files=$((total_files + 1))
  out=$(node "$f" 2>&1)
  # Count PASS/FAIL as whole words so this can't accidentally match inside a longer word or a
  # human-readable sentence that happens to contain "pass"/"fail" as a substring.
  pass_count=$(printf '%s\n' "$out" | grep -oE '\bPASS\b' | wc -l | tr -d ' ')
  fail_count=$(printf '%s\n' "$out" | grep -oE '\bFAIL\b' | wc -l | tr -d ' ')
  # A script that crashed outright (syntax error, uncaught exception) produces zero PASS/FAIL lines
  # at all -- that's just as much a real failure as a logged FAIL, so it's caught here too rather
  # than silently reading as "0 checks, all green."
  if [ "$pass_count" -eq 0 ] && [ "$fail_count" -eq 0 ]; then
    echo "=== $f ==="
    echo "  CRASHED — no PASS/FAIL output at all:"
    printf '%s\n' "$out" | tail -10 | sed 's/^/    /'
    failed_files+=("$f (crashed)")
    total_fail=$((total_fail + 1))
    continue
  fi
  total_pass=$((total_pass + pass_count))
  total_fail=$((total_fail + fail_count))
  if [ "$fail_count" -gt 0 ]; then
    echo "=== $f ==="
    printf '%s\n' "$out" | grep -B1 '\bFAIL\b'
    failed_files+=("$f")
  fi
done

echo ""
echo "──────────────────────────────────────────────────────────"
echo "$total_files files, $((total_pass + total_fail)) checks: $total_pass passed, $total_fail failed"
if [ ${#failed_files[@]} -gt 0 ]; then
  echo "Failing files: ${failed_files[*]}"
  exit 1
fi
echo "All clear."
exit 0
