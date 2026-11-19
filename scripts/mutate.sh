#!/usr/bin/env bash
# Mutation testing with StrykerJS (needs Node >= 22; bun runs the tests through Stryker's command runner,
# because Stryker has no Bun test runner). Usage:  scripts/mutate.sh [file ...]
# With no files, mutates every target listed below. Each target runs only the test files that cover it.
set -euo pipefail
cd "$(dirname "$0")/.."
NODE22="${NODE22:-$(ls -d "$HOME"/.nvm/versions/node/v2[2-9]*/bin 2>/dev/null | tail -1 || true)}"
[ -n "${NODE22:-}" ] && export PATH="$NODE22:$PATH"
CONC="${MUTATE_CONCURRENCY:-8}"

tests_for() {
  case "$1" in
    src/shared/content.ts) echo "bun test src/shared/content.test.ts src/shared/exercise-content.test.ts" ;;
    src/shared/*) echo "bun test src/shared" ;;
    src/server/mcp.ts) echo "bun test src/server/mcp.test.ts src/server/mcp.mutation.test.ts src/server/mcp.streak.test.ts" ;;
    src/server/api.ts|src/server/store.ts) echo "bun test src/server/api.test.ts src/server/api.mutation.test.ts src/server/mcp.test.ts" ;;
    src/server/ext/magic.ts) echo "bun test src/server/ext/magic.test.ts src/server/ext/magic.mutation.test.ts" ;;
    src/server/ext/push.ts) echo "bun test src/server/ext/push.test.ts src/server/ext/push.mutation.test.ts src/server/ext/push.streak.test.ts" ;;
    *) echo "bun test src" ;;
  esac
}

targets=("$@")
[ ${#targets[@]} -eq 0 ] && targets=(src/shared/rules.ts src/shared/streak.ts src/shared/planner.ts src/shared/content.ts src/server/api.ts src/server/mcp.ts src/server/ext/magic.ts)
mkdir -p reports/mutation
for f in "${targets[@]}"; do
  echo "=== mutating $f ==="
  name="$(echo "$f" | tr '/' '_')"
  conf="reports/mutation/.conf.$name.json"
  # per-target config = stryker.conf.json + the tests that cover this file + its own JSON report
  node -e '
    const [file, cmd, conc, out] = process.argv.slice(1);
    const c = JSON.parse(require("fs").readFileSync("stryker.conf.json", "utf8"));
    c.mutate = [file]; c.commandRunner = { command: cmd }; c.concurrency = +conc; c.jsonReporter = { fileName: out };
    c.ignorePatterns = [...(c.ignorePatterns || []), "reports"];
    console.log(JSON.stringify(c, null, 2));
  ' "$f" "$(tests_for "$f")" "$CONC" "reports/mutation/$name.json" > "$conf"
  node node_modules/@stryker-mutator/core/bin/stryker.js run "$conf"
done
