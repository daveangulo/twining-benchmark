#!/bin/bash
# Smoke test for Twining plugin v1.1.5 behavioral changes
# Runs 1 iteration of refactoring-handoff (2 agents) for full-twining
# Then checks that the plugin changes had the desired effect
set -uo pipefail

SEED="plugin-v1.1.5-smoke-$(date +%s)"
RESULTS_DIR="benchmark-results"

echo "=== Twining Plugin v1.1.5 Smoke Test ==="
echo "Seed: $SEED"
echo ""

# ── Run benchmark ──────────────────────────────────────────────────
echo "Running benchmark (refactoring-handoff, full-twining, 1 iteration)..."
echo "This will take ~10 minutes and cost ~\$1.50."
echo ""

RUN_OUTPUT=$(npx tsx src/cli/index.ts run \
  --scenario refactoring-handoff \
  --condition full-twining \
  --runs 1 \
  --seed "$SEED" 2>&1) || {
  echo "FAIL: Benchmark run failed"
  echo "$RUN_OUTPUT"
  exit 1
}

# Extract run ID from output
RUN_ID=$(echo "$RUN_OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)

if [[ -z "$RUN_ID" ]]; then
  echo "FAIL: Could not extract run ID from output"
  echo "$RUN_OUTPUT"
  exit 1
fi

echo "Run completed: $RUN_ID"
echo ""

# ── Analyze results ────────────────────────────────────────────────
RUN_DIR="$RESULTS_DIR/$RUN_ID"
PASS=0
FAIL=0
WARN=0

check() {
  local name="$1" result="$2" expected="$3"
  if [[ "$result" == "$expected" ]]; then
    echo "  PASS  $name (got: $result)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (got: $result, expected: $expected)"
    FAIL=$((FAIL + 1))
  fi
}

check_gte() {
  local name="$1" result="$2" min="$3"
  if [[ "$result" -ge "$min" ]]; then
    echo "  PASS  $name (got: $result, min: $min)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (got: $result, expected >= $min)"
    FAIL=$((FAIL + 1))
  fi
}

check_warn() {
  local name="$1" result="$2" expected="$3"
  if [[ "$result" == "$expected" ]]; then
    echo "  PASS  $name (got: $result)"
    PASS=$((PASS + 1))
  else
    echo "  WARN  $name (got: $result, expected: $expected)"
    WARN=$((WARN + 1))
  fi
}

echo "=== Signal Checks ==="
echo ""

# Collect full-twining session paths
FT_SESSIONS=()
for d in "$RUN_DIR"/sessions/*/; do
  t="$d/transcript.json"
  [[ -f "$t" ]] || continue
  cond=$(python3 -c "import json; print(json.load(open('$t')).get('condition',''))")
  if [[ "$cond" == "full-twining" ]]; then
    FT_SESSIONS+=("$d")
  fi
done

FT_COUNT=${#FT_SESSIONS[@]}
echo "Full-twining sessions found: $FT_COUNT"
echo ""

# ── 1. twining_register called ─────────────────────────────────────
echo "1. twining_register (was: 0/27, target: every session)"
REGISTER_COUNT=0
for d in "${FT_SESSIONS[@]}"; do
  t="$d/transcript.json"
  has=$(grep -c 'twining_register' "$t" 2>/dev/null || echo 0)
  task=$(python3 -c "import json; print(json.load(open('$t')).get('taskIndex',0))")
  sid=$(basename "$d")
  echo "    session ${sid:0:8} (task=$task): register=$has"
  if [[ "$has" -gt 0 ]]; then REGISTER_COUNT=$((REGISTER_COUNT + 1)); fi
done
check "twining_register in all sessions" "$REGISTER_COUNT" "$FT_COUNT"
echo ""

# ── 2. twining_search_decisions called ─────────────────────────────
echo "2. twining_search_decisions (was: 0/27, target: at least 1 session)"
SEARCH_COUNT=0
for d in "${FT_SESSIONS[@]}"; do
  t="$d/transcript.json"
  has=$(grep -c 'twining_search_decisions' "$t" 2>/dev/null || echo 0)
  task=$(python3 -c "import json; print(json.load(open('$t')).get('taskIndex',0))")
  sid=$(basename "$d")
  echo "    session ${sid:0:8} (task=$task): search_decisions=$has"
  if [[ "$has" -gt 0 ]]; then SEARCH_COUNT=$((SEARCH_COUNT + 1)); fi
done
check_gte "twining_search_decisions in >= 1 session" "$SEARCH_COUNT" 1
echo ""

# ── 3. twining_handoff in every session ────────────────────────────
echo "3. twining_handoff (was: 78%, target: 100%)"
HANDOFF_COUNT=0
for d in "${FT_SESSIONS[@]}"; do
  t="$d/transcript.json"
  has=$(grep -c 'twining_handoff' "$t" 2>/dev/null || echo 0)
  task=$(python3 -c "import json; print(json.load(open('$t')).get('taskIndex',0))")
  sid=$(basename "$d")
  echo "    session ${sid:0:8} (task=$task): handoff=$has"
  if [[ "$has" -gt 0 ]]; then HANDOFF_COUNT=$((HANDOFF_COUNT + 1)); fi
done
check "twining_handoff in all sessions" "$HANDOFF_COUNT" "$FT_COUNT"
echo ""

# ── 4. Stop hook block/recover ─────────────────────────────────────
echo "4. Stop hook enforcement (check if block occurred and agent recovered)"
for d in "${FT_SESSIONS[@]}"; do
  t="$d/transcript.json"
  blocks=$(grep -c 'No twining_handoff found\|Twining housekeeping required' "$t" 2>/dev/null || echo 0)
  sid=$(basename "$d")
  echo "    session ${sid:0:8}: stop-hook blocks=$blocks"
done
echo "    (blocks=0 means agent complied proactively; blocks>0 means hook caught it)"
echo ""

# ── 5. Decisions & graph captured ──────────────────────────────────
echo "5. Coordination artifacts captured (was: wrong file paths)"
DEC_CAPTURED=0
GRAPH_CAPTURED=0
for d in "${FT_SESSIONS[@]}"; do
  a="$d/coordination-artifacts.json"
  [[ -f "$a" ]] || continue
  sid=$(basename "$d")
  python3 -c "
import json
a = json.load(open('$a'))
post = a.get('postSessionState', {})
dec = post.get('.twining/decisions/index.json', '')
ent = post.get('.twining/graph/entities.json', '')
rel = post.get('.twining/graph/relations.json', '')
print(f'dec={len(dec)} ent={len(ent)} rel={len(rel)}')
" | while read -r line; do echo "    session ${sid:0:8}: $line"; done

  dec_ok=$(python3 -c "
import json
a = json.load(open('$a'))
dec = a.get('postSessionState', {}).get('.twining/decisions/index.json', '')
print(1 if len(dec) > 5 else 0)
")
  graph_ok=$(python3 -c "
import json
a = json.load(open('$a'))
ent = a.get('postSessionState', {}).get('.twining/graph/entities.json', '')
print(1 if len(ent) > 5 else 0)
")
  if [[ "$dec_ok" -gt 0 ]]; then DEC_CAPTURED=$((DEC_CAPTURED + 1)); fi
  if [[ "$graph_ok" -gt 0 ]]; then GRAPH_CAPTURED=$((GRAPH_CAPTURED + 1)); fi
done
check_gte "decisions/index.json captured in >= 1 session" "$DEC_CAPTURED" 1
check_warn "graph/entities.json captured in >= 1 session" "$GRAPH_CAPTURED" "1"
echo ""

# ── 6. CES scores ─────────────────────────────────────────────────
echo "6. CES composite scores"
python3 -c "
import json, glob, os

scores = []
for f in glob.glob(os.path.join('$RUN_DIR', 'scores', '*.json')):
    scores.append(json.load(open(f)))

for cond in ['baseline', 'full-twining']:
    s = [r for r in scores if r['condition'] == cond]
    if s:
        avg = sum(r['composite'] for r in s) / len(s)
        print(f'  {cond:25s} CES={avg:.1f}')
        for r in s:
            m = r['metrics']
            print(f'    iter={r[\"iteration\"]} composite={r[\"composite\"]:.1f} cost=\${m[\"costUsd\"]:.2f} time={m[\"wallTimeMs\"]/1000:.0f}s')
            for dim, val in r['scores'].items():
                print(f'      {dim}: {val[\"value\"]:.0f} (conf={val[\"confidence\"]})')
"
echo ""

# ── 7. Full tool call breakdown ────────────────────────────────────
echo "7. Full Twining tool call breakdown (full-twining sessions)"
python3 -c "
import json, os
from collections import Counter

counts = Counter()
total = 0
for d_name in os.listdir('$RUN_DIR/sessions/'):
    t_path = os.path.join('$RUN_DIR/sessions/', d_name, 'transcript.json')
    if not os.path.isfile(t_path):
        continue
    t = json.load(open(t_path))
    if t.get('condition') != 'full-twining':
        continue
    total += 1
    for tc in t.get('toolCalls', []):
        name = tc.get('toolName', '')
        if 'twining' in name:
            short = name.replace('mcp__plugin_twining_twining__', '')
            counts[short] += 1

print(f'  Total sessions: {total}')
print(f'  {\"Tool\":35s} {\"Count\":>5s} {\"Per session\":>11s}')
print(f'  {\"-\"*35} {\"-\"*5} {\"-\"*11}')
for tool, count in counts.most_common():
    print(f'  {tool:35s} {count:5d} {count/total:11.1f}')
"
echo ""

# ── Summary ────────────────────────────────────────────────────────
echo "=== Summary ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  WARN: $WARN"
echo "  Run ID: $RUN_ID"
echo ""

if [[ "$FAIL" -eq 0 ]]; then
  echo "All checks passed. Plugin v1.1.5 changes are working."
  exit 0
else
  echo "Some checks failed. Review output above."
  exit 1
fi
