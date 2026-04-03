# Scorer & Analysis Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four issues identified from clean benchmark run analysis: broken assumptionHandling scorer, narrow finalQuality scorer, uninvestigated decisionConsistency behavior, and uninformative effect decomposition.

**Architecture:** All scorer changes are in `src/scenarios/sprint-simulation.ts` (TypeScript harness). Effect decomposition and recommendations are in `analysis/src/benchmark_analysis/` (Python). Changes are scoped to scoring logic — no changes to the runner, orchestrator, or session infrastructure.

**Tech Stack:** TypeScript (vitest), Python 3.12+ (pytest)

---

## Task 1: Fix assumptionHandling — Add Graduated Scoring

**Problem:** Always scores 100 across all conditions. The regex checks are too lenient — every agent that builds an SMS adapter naturally produces text matching "preference", "sms", "channel", and routing patterns, regardless of whether it actually *handled the assumption change* properly.

**Root cause:** The scorer checks for keyword presence in diffs but doesn't distinguish between:
- Session 8 recognizing "the preferences model assumes email-only and needs updating" (the actual assumption handling) vs simply writing code that mentions email
- Session 9 actively restructuring preferences for multi-channel vs just adding an SMS adapter alongside existing code

**Fix:** Require evidence of *awareness and response to the assumption*, not just keyword overlap with the task output.

**Files:**
- Modify: `src/scenarios/sprint-simulation.ts:733-814` (scoreAssumptionHandling)

- [ ] **Step 1: Analyze current scoring against real data**

Before changing the scorer, verify the diagnosis. Pick one full-twining iteration score file and read its assumptionHandling justification to confirm every run gets 100:

```bash
cat benchmark-results/6393b4ac-6988-4e2d-bc2d-f78cf5cafb46/scores/sprint-simulation_baseline_0.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['scores']['assumptionHandling'])"
```

Also spot-check a baseline session 8 diff to see what text is matching:

```bash
# Find session for baseline iter 0, task index 7 (session 8)
python3 -c "
import json,os
base='benchmark-results/6393b4ac-6988-4e2d-bc2d-f78cf5cafb46'
for f in sorted(os.listdir(f'{base}/raw')):
    if not f.endswith('.json'): continue
    with open(f'{base}/raw/{f}') as fh:
        r = json.load(fh)
    if r.get('condition')=='baseline' and r.get('taskIndex')==7:
        print(f'Session 8 baseline: {f}')
        break
"
```

Read the session transcript's fileChanges to understand what the baseline agent does at session 8.

- [ ] **Step 2: Rewrite scoreAssumptionHandling with graduated criteria**

Replace the method in `src/scenarios/sprint-simulation.ts:733-814`:

```typescript
  private scoreAssumptionHandling(rawResults: RawResults): DimensionScore {
    const session8 = rawResults.transcripts[7]; // 0-indexed
    const session9 = rawResults.transcripts[8];

    if (!session8 || !session9) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Sessions 8 or 9 did not produce transcripts.',
      };
    }

    let score = 0;
    const details: string[] = [];

    // --- Session 8: Did it IDENTIFY the assumption conflict? (+40) ---
    // Session 8's task is "add SMS support and flag assumptions that need updating."
    // A good response explicitly calls out that preferences were built for email-only.
    // We check tool call output text AND diffs for explicit assumption language.
    const s8Diffs = session8.fileChanges
      .filter((c) => !/.twining|COORDINATION|CONTEXT/i.test(c.path))
      .map((c) => c.diff ?? '').join('\n');
    const s8ToolText = session8.toolCalls
      .map((tc) => JSON.stringify(tc.parameters)).join('\n');
    const s8Combined = s8Diffs + '\n' + s8ToolText;

    // Strong signal: explicit mention of the assumption conflict
    const explicitAssumptionFlag =
      /assum.*email.?only|email.?only.*assum|preferences?.*(need|require|must).*(updat|chang|refactor|extend)|single.?channel.*assum|hardcoded.*email/i.test(s8Combined);
    // Weak signal: just mentions preferences need work alongside SMS
    const weakAssumptionFlag =
      /preference.*multi|preference.*sms|preference.*channel|update.*preference/i.test(s8Combined) &&
      !explicitAssumptionFlag;

    if (explicitAssumptionFlag) {
      score += 40;
      details.push('Session 8 explicitly flagged the email-only assumption.');
    } else if (weakAssumptionFlag) {
      score += 15;
      details.push('Session 8 mentioned preference updates but did not explicitly flag the assumption conflict.');
    } else {
      details.push('Session 8 did NOT flag any assumption about email-only design.');
    }

    // --- Session 9: Did it RESTRUCTURE preferences for multi-channel? (+35) ---
    // Not just "does the diff mention SMS" but did the preferences model actually
    // change from email-centric to channel-generic?
    const s9PrefDiffs = session9.fileChanges
      .filter((c) => /preference/i.test(c.path) && !/.twining|COORDINATION|CONTEXT/i.test(c.path))
      .map((c) => c.diff ?? '').join('\n');
    const s9AllDiffs = session9.fileChanges
      .filter((c) => !/.twining|COORDINATION|CONTEXT/i.test(c.path))
      .map((c) => c.diff ?? '').join('\n');

    // Strong: preferences model changed to support channel types (not just email fields)
    const prefRestructured =
      /channel.*type|NotificationChannel|ChannelPreference|channels?\s*[.:=]\s*\[|Map<.*channel/i.test(s9PrefDiffs) &&
      s9PrefDiffs.length > 100; // must be a substantive change, not a comment
    // Weak: preferences file touched but only minor additions
    const prefTouched = s9PrefDiffs.length > 20 && /sms|channel/i.test(s9PrefDiffs);

    if (prefRestructured) {
      score += 35;
      details.push('Session 9 restructured preferences model for multi-channel.');
    } else if (prefTouched) {
      score += 15;
      details.push('Session 9 touched preferences but did not restructure for multi-channel.');
    } else {
      details.push('Session 9 did NOT update preferences model.');
    }

    // --- Session 9: End-to-end multi-channel routing? (+25) ---
    // Check for channel dispatch logic that actually routes based on preference
    const hasPreferenceBasedRouting =
      /preference.*channel|channel.*preference|getPreferred|channelFor/i.test(s9AllDiffs) &&
      /switch|if.*channel|forEach.*channel|map.*channel/i.test(s9AllDiffs);
    const hasBasicMultiChannel =
      /sms/i.test(s9AllDiffs) && /webhook|push|slack/i.test(s9AllDiffs);

    if (hasPreferenceBasedRouting) {
      score += 25;
      details.push('Session 9 implemented preference-based channel routing.');
    } else if (hasBasicMultiChannel) {
      score += 10;
      details.push('Session 9 added multiple channels but without preference-based routing.');
    } else {
      details.push('Session 9 did NOT implement multi-channel routing.');
    }

    return {
      value: score,
      confidence: score > 50 ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }
```

Key changes:
- **Session 8 flag (+40 max, was +30):** Now requires explicit assumption-conflict language, not just "email" + "preference" keyword overlap. Weak signal gives only 15.
- **Session 9 preferences (+35 unchanged):** Now checks for structural refactoring (channel types, channel arrays) with minimum diff size, not just keyword presence.
- **Session 9 routing (+25 max, was +35):** Reduced weight, now requires preference-based routing (checking user channel preferences), not just "multiple channel types exist."
- Total still 100 max, but achieving it requires genuinely handling the assumption at each stage.

- [ ] **Step 3: Run existing tests**

```bash
npx vitest run tests/unit/scenarios/ --reporter=verbose
```

Fix any failures from the signature change (the method signature is unchanged, so this should pass).

- [ ] **Step 4: Commit**

```bash
git add src/scenarios/sprint-simulation.ts
git commit -m "fix(scorer): graduate assumptionHandling to require explicit assumption flagging

Previously scored 100 for all conditions because regex matched generic SMS-related
keywords that every agent produces. Now requires explicit assumption-conflict
identification (session 8) and structural preference refactoring (session 9)."
```

---

## Task 2: Redesign finalQuality — Add Code Structure Depth

**Problem:** Scores 89-93 across all conditions (4pt spread). The scorer is dominated by binary checks (compiles? tests pass?) that every condition satisfies. The component-completeness and architecture-consistency sub-scores also compress because all agents build similar components.

**Fix:** Add two new sub-dimensions that capture structural quality differences coordination tools might enable:
- **Test coverage depth** (0-15): Not just "tests pass" but ratio of test files to source files, and whether tests exist for each component.
- **API consistency** (0-10): Do exported interfaces follow consistent naming/patterns across modules?

Rebalance weights to make room while keeping compile+tests as the floor.

**Files:**
- Modify: `src/scenarios/sprint-simulation.ts:1028-1170` (scoreFinalQualityAutomated)

- [ ] **Step 1: Redesign the sub-score allocation**

New breakdown (still 0-100 total):
- Compilation: 0-15 (was 0-20) — binary, keeps floor
- Test pass rate: 0-20 (was 0-30) — still important but less dominant
- Component completeness: 0-20 (was 0-25) — reduced slightly
- Architecture consistency: 0-15 (unchanged) — already discriminating
- **Test coverage depth: 0-15 (NEW)** — tests per component, not just pass/fail
- **API surface consistency: 0-15 (NEW)** — naming patterns, export consistency

- [ ] **Step 2: Implement the redesigned scorer**

Replace `scoreFinalQualityAutomated` in `src/scenarios/sprint-simulation.ts:1028-1170`:

```typescript
  private scoreFinalQualityAutomated(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const lastSession = rawResults.transcripts[rawResults.transcripts.length - 1];
    if (!lastSession) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Final session did not produce a transcript.',
      };
    }

    let score = 0;
    const details: string[] = [];

    // Collect all files and diffs across sessions
    const allFiles = new Set<string>();
    const allDiffs: string[] = [];
    for (const t of rawResults.transcripts) {
      for (const fc of t.fileChanges) {
        allFiles.add(fc.path);
        if (fc.diff) allDiffs.push(fc.diff);
      }
    }
    const combinedDiffs = allDiffs.join('\n');

    // 1. Compilation (0-15)
    if (rawResults.testResults) {
      if (rawResults.testResults.compiles) {
        score += 15;
        details.push('Compiles.');
      } else {
        details.push('Does NOT compile.');
      }
    } else {
      const ranTsc = lastSession.toolCalls.some((tc) =>
        tc.toolName === 'Bash' &&
        /tsc|npm run build|npm test/i.test(String(tc.parameters?.command ?? '')),
      );
      if (ranTsc) {
        score += 8;
        details.push('Final session ran build/tests (compilation unverified).');
      }
    }

    // 2. Test pass rate (0-20)
    if (rawResults.testResults) {
      const { pass, fail } = rawResults.testResults;
      const total = pass + fail;
      if (total > 0) {
        const passRate = pass / total;
        const testScore = Math.round(passRate * 20);
        score += testScore;
        details.push(`Tests: ${pass}/${total} pass (${Math.round(passRate * 100)}%).`);
      } else {
        details.push('No tests found.');
      }
    } else {
      const ranTests = lastSession.toolCalls.some((tc) =>
        tc.toolName === 'Bash' &&
        /npm test|vitest|jest/i.test(String(tc.parameters?.command ?? '')),
      );
      if (ranTests) {
        score += 7;
        details.push('Final session ran tests (results unavailable).');
      }
    }

    // 3. Component completeness (0-20)
    const expectedComponents = [
      { id: 'notification-service', filePattern: /notification.*service/i, diffPattern: /class\s+\w*Notification\w*Service|notification.*service/i },
      { id: 'email-adapter', filePattern: /email.*adapter|adapter.*email/i, diffPattern: /class\s+\w*Email\w*Adapter|implements\s+\w*Adapter/i },
      { id: 'sms-adapter', filePattern: /sms.*adapter|adapter.*sms/i, diffPattern: /class\s+\w*Sms\w*Adapter|class\s+\w*SMS\w*Adapter/i },
      { id: 'webhook-adapter', filePattern: /webhook.*adapter|adapter.*webhook/i, diffPattern: /class\s+\w*Webhook\w*Adapter/i },
      { id: 'preferences', filePattern: /preference/i, diffPattern: /class\s+\w*Preference|interface\s+\w*Preference|channel/i },
    ];

    let componentsFound = 0;
    for (const comp of expectedComponents) {
      const fileExists = [...allFiles].some((f) => comp.filePattern.test(f));
      const hasDiffEvidence = comp.diffPattern.test(combinedDiffs);
      if (fileExists && hasDiffEvidence) {
        componentsFound++;
      }
    }
    const componentScore = Math.round((componentsFound / expectedComponents.length) * 20);
    score += componentScore;
    details.push(`${componentsFound}/${expectedComponents.length} components verified in code.`);

    // 4. Architecture consistency (0-15) — do adapters follow the same interface?
    const adapterDiffs = allDiffs.filter((d) => /adapter/i.test(d)).join('\n');
    const implementsMatch = adapterDiffs.match(/implements\s+(\w+)/gi) ?? [];
    const interfaceNames = implementsMatch.map((m) => m.replace(/implements\s+/i, ''));
    const uniqueInterfaces = new Set(interfaceNames);

    if (interfaceNames.length >= 2 && uniqueInterfaces.size === 1) {
      score += 15;
      details.push(`Adapters share interface: ${[...uniqueInterfaces][0]}.`);
    } else if (interfaceNames.length >= 2 && uniqueInterfaces.size <= 2) {
      score += 8;
      details.push(`Adapters use ${uniqueInterfaces.size} different interfaces.`);
    } else if (interfaceNames.length >= 1) {
      score += 4;
      details.push('Only one adapter implements an interface.');
    } else {
      details.push('No adapter interface pattern detected.');
    }

    // 5. Test coverage depth (0-15) — test files per component
    const srcFiles = [...allFiles].filter((f) => /^src\//i.test(f) && !/.twining|COORDINATION|CONTEXT/i.test(f));
    const testFiles = [...allFiles].filter((f) => /test/i.test(f) && !/.twining|COORDINATION|CONTEXT/i.test(f));

    // Check which components have dedicated tests
    const componentTestPatterns = [
      { id: 'notification', pattern: /notification/i },
      { id: 'email-adapter', pattern: /email/i },
      { id: 'sms-adapter', pattern: /sms/i },
      { id: 'webhook-adapter', pattern: /webhook/i },
      { id: 'preferences', pattern: /preference/i },
      { id: 'validation', pattern: /validat/i },
      { id: 'pagination', pattern: /paginat/i },
    ];
    let testedComponents = 0;
    for (const comp of componentTestPatterns) {
      if (testFiles.some((f) => comp.pattern.test(f))) {
        testedComponents++;
      }
    }
    const coverageRatio = componentTestPatterns.length > 0 ? testedComponents / componentTestPatterns.length : 0;
    const coverageScore = Math.round(coverageRatio * 15);
    score += coverageScore;
    details.push(`${testedComponents}/${componentTestPatterns.length} components have test files.`);

    // 6. API surface consistency (0-15) — naming and export patterns
    // Check: do service classes follow consistent naming? Are types exported consistently?
    const serviceFiles = [...allFiles].filter((f) => /service/i.test(f) && /^src\//i.test(f));
    const adapterFiles = [...allFiles].filter((f) => /adapter/i.test(f) && /^src\//i.test(f));

    // Consistent file naming: services end in .service.ts, adapters in .adapter.ts
    const consistentServiceNaming = serviceFiles.length > 0 &&
      serviceFiles.every((f) => /\.service\.(ts|js)$/i.test(f));
    const consistentAdapterNaming = adapterFiles.length > 0 &&
      adapterFiles.every((f) => /\.adapter\.(ts|js)$/i.test(f));

    // Check for exported interfaces/types
    const hasExportedTypes = /export\s+(interface|type)\s+\w+/i.test(combinedDiffs);
    // Check for consistent method naming in adapters (e.g., all have send())
    const adapterMethods = adapterDiffs.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*[:{]/g) ?? [];
    const methodNames = adapterMethods.map((m) => m.match(/(\w+)\s*\(/)?.[1]).filter(Boolean);
    const hasSendMethod = methodNames.filter((n) => /^send$/i.test(n!)).length;

    let apiScore = 0;
    if (consistentServiceNaming) apiScore += 4;
    if (consistentAdapterNaming) apiScore += 4;
    if (hasExportedTypes) apiScore += 4;
    if (hasSendMethod >= 2) apiScore += 3; // multiple adapters share send()
    score += apiScore;
    details.push(`API consistency: ${apiScore}/15 (naming=${consistentServiceNaming && consistentAdapterNaming ? 'consistent' : 'mixed'}, types=${hasExportedTypes ? 'exported' : 'implicit'}, methods=${hasSendMethod >= 2 ? 'consistent' : 'varied'}).`);

    return {
      value: Math.min(100, score),
      confidence: rawResults.testResults ? 'medium' : 'low',
      method: 'automated',
      justification: details.join(' '),
    };
  }
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/unit/scenarios/ --reporter=verbose
```

- [ ] **Step 4: Commit**

```bash
git add src/scenarios/sprint-simulation.ts
git commit -m "fix(scorer): redesign finalQuality with test coverage depth and API consistency

Old scorer compressed to 89-93 range (4pt spread) because it was dominated
by binary compile+pass checks. New sub-dimensions:
- Test coverage depth (0-15): tests per component, not just pass/fail
- API surface consistency (0-15): naming patterns, export patterns, method consistency
Rebalanced existing sub-scores to accommodate."
```

---

## Task 3: Investigate decisionConsistency — Fix Pattern Detection

**Problem:** Scores 57-64 across all conditions with high variance (stdev 12-18). Coordination tools don't improve this score — full-twining (58.4) actually scores slightly lower than baseline (64.2). This is the dimension coordination should most impact, so either the scorer is measuring the wrong thing or pattern detection is unreliable.

**Diagnosis approach:** Check what pattern detection is actually finding in session 1, and whether the consistency checks in later sessions are matching correctly.

**Files:**
- Modify: `src/scenarios/sprint-simulation.ts:639-722` (scoreDecisionConsistency)

- [ ] **Step 1: Diagnose by examining actual score justifications**

```bash
python3 << 'PYEOF'
import json, os, re

base = "benchmark-results/6393b4ac-6988-4e2d-bc2d-f78cf5cafb46"
for cond in ['baseline', 'full-twining', 'twining-lite']:
    for i in range(5):
        path = f"{base}/scores/sprint-simulation_{cond}_{i}.json"
        with open(path) as f:
            d = json.load(f)
        dc = d['scores']['decisionConsistency']
        print(f"{cond} iter {i}: value={dc['value']} | {dc['justification'][:200]}")
    print()
PYEOF
```

This will reveal:
- What pattern is being detected (event-driven vs direct-calls)
- Which sessions are failing consistency checks
- Whether the issue is pattern detection sensitivity or genuine inconsistency

- [ ] **Step 2: Read session 1 diffs from multiple conditions to understand detection**

```bash
python3 << 'PYEOF'
import json, os

base = "benchmark-results/6393b4ac-6988-4e2d-bc2d-f78cf5cafb46"
for cond in ['baseline', 'full-twining']:
    # Find session with taskIndex 0
    for f in sorted(os.listdir(f"{base}/raw")):
        if not f.endswith('.json'): continue
        with open(f"{base}/raw/{f}") as fh:
            raw = json.load(fh)
        if raw.get('condition') == cond and raw.get('taskIndex') == 0:
            sid = f.replace('.json', '')
            tp = f"{base}/sessions/{sid}/transcript.json"
            with open(tp) as fh:
                t = json.load(fh)
            # Show first 500 chars of file changes
            for fc in t.get('fileChanges', [])[:3]:
                diff = (fc.get('diff', '') or '')[:300]
                print(f"\n{cond} session1 file: {fc.get('path', '?')}")
                print(diff)
            break
    print("---")
PYEOF
```

- [ ] **Step 3: Fix pattern detection based on diagnosis**

Based on what step 1 reveals, the fix will likely be one of:

**If the issue is pattern detection being too narrow** (likely — the regex only catches specific keywords), broaden the detection:

```typescript
  private scoreDecisionConsistency(
    rawResults: RawResults,
    _groundTruth: ArchitecturalManifest,
  ): DimensionScore {
    const session1 = rawResults.transcripts[0];
    if (!session1) {
      return {
        value: 0,
        confidence: 'high',
        method: 'automated',
        justification: 'Session 1 did not produce a transcript.',
      };
    }

    // Detect which notification pattern Session 1 chose
    const s1Diffs = session1.fileChanges
      .filter((c) => !/.twining|COORDINATION|CONTEXT/i.test(c.path))
      .map((c) => c.diff ?? '').join('\n');

    // Broader pattern detection — check for common event-driven AND direct-call patterns
    const eventDrivenSignals = [
      /event[\s-]?bus/i,
      /\.emit\s*\(/i,
      /\.on\s*\(\s*['"][a-z]/i,
      /addEventListener|subscribe|listener/i,
      /pub[\s-]?sub|EventEmitter/i,
      /new\s+Event/i,
      /observer|Observable/i,
    ];
    const directCallSignals = [
      /notif.*service\./i,
      /service\.send|service\.notify/i,
      /inject.*service|@Inject/i,
      /new\s+\w*Service\s*\(/i,
      /this\.\w*service\.\w+\(/i,
    ];

    const eventScore = eventDrivenSignals.filter((r) => r.test(s1Diffs)).length;
    const directScore = directCallSignals.filter((r) => r.test(s1Diffs)).length;

    if (eventScore === 0 && directScore === 0) {
      // Cannot detect any pattern — try a broader heuristic
      // Check if session 1 created any service file with method calls
      const hasServiceFile = session1.fileChanges.some((c) =>
        /service/i.test(c.path) && (c.diff?.length ?? 0) > 50,
      );
      if (!hasServiceFile) {
        return {
          value: 50,
          confidence: 'low',
          method: 'automated',
          justification: 'Could not detect notification pattern from Session 1 diffs — no service files created.',
        };
      }
      // Default to direct-calls if there's a service but no event patterns
      return this.checkConsistencyAgainstPattern(rawResults, 'direct-calls', directCallSignals);
    }

    const chosenPattern = eventScore > directScore ? 'event-driven' : 'direct-calls';
    const patternSignals = chosenPattern === 'event-driven' ? eventDrivenSignals : directCallSignals;

    return this.checkConsistencyAgainstPattern(rawResults, chosenPattern, patternSignals);
  }

  private checkConsistencyAgainstPattern(
    rawResults: RawResults,
    chosenPattern: string,
    patternSignals: RegExp[],
  ): DimensionScore {
    // Check ALL sessions that produce code (not just hardcoded indices)
    let consistentCount = 0;
    let checkedCount = 0;
    const details: string[] = [];

    for (let idx = 1; idx < rawResults.transcripts.length; idx++) {
      const t = rawResults.transcripts[idx];
      if (!t) continue;

      const diffs = t.fileChanges
        .filter((c) => !/.twining|COORDINATION|CONTEXT|coordination/i.test(c.path))
        .map((c) => c.diff ?? '').join('\n');

      // Skip sessions that don't touch notification-related code
      if (!/notification|adapter|service.*notify|event.*bus/i.test(diffs)) {
        continue;
      }

      checkedCount++;
      const matchCount = patternSignals.filter((r) => r.test(diffs)).length;

      if (matchCount >= 1) {
        consistentCount++;
      } else {
        details.push(`Session ${idx + 1} did not follow ${chosenPattern} pattern.`);
      }
    }

    if (checkedCount === 0) {
      return {
        value: 50,
        confidence: 'low',
        method: 'automated',
        justification: `Pattern: ${chosenPattern}. No later sessions touched notification-related code.`,
      };
    }

    const score = Math.round((consistentCount / checkedCount) * 100);

    return {
      value: score,
      confidence: checkedCount >= 3 ? 'medium' : 'low',
      method: 'automated',
      justification: details.length > 0
        ? `Pattern: ${chosenPattern}. ${consistentCount}/${checkedCount} sessions consistent. ${details.join(' ')}`
        : `Pattern: ${chosenPattern}. All ${checkedCount} checked sessions followed it consistently.`,
    };
  }
```

Key changes:
- **Multiple signal regexes instead of one** — scores presence of multiple signals rather than a single pattern match, reducing false negatives
- **Dynamic session selection** — checks all sessions that touch notification code, not hardcoded indices [1,5,7,8-11] which may miss or incorrectly include sessions
- **Broader event-driven detection** — EventEmitter, observer, Observable, addEventListener, not just "event-bus" and "emit"
- **Broader direct-call detection** — constructor injection, `this.service.method()`, not just "notification.service."

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/unit/scenarios/ --reporter=verbose
```

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/sprint-simulation.ts
git commit -m "fix(scorer): broaden decisionConsistency pattern detection

Pattern detection was too narrow (single regex per pattern type), causing
high false-negative rates. Now uses multiple signal regexes and dynamically
selects which sessions to check based on notification-related code changes
rather than hardcoded session indices."
```

---

## Task 4: Fix Effect Decomposition — Render Lite-vs-Full and Per-Tool Data

**Problem:** The effect decomposition table shows identical values (-3.19) for all 8 mechanisms because all Twining tools are used by the same conditions (full-twining and twining-lite), so the heavy-user/non-user split is always the same. The useful data (lite_vs_full comparison, per-tool utilization, never-called tools) is computed but never rendered in the markdown report.

**Fix:** 
1. Render the lite_vs_full comparison in the report
2. Render per-tool utilization counts 
3. Render never-called tools list
4. When all mechanisms produce identical values, collapse them into a single note instead of a misleading table

**Files:**
- Modify: `analysis/src/benchmark_analysis/reports/markdown.py:115-142` (effect decomposition section)

- [ ] **Step 1: Read the current markdown renderer to understand the structure**

```bash
cat analysis/src/benchmark_analysis/reports/markdown.py
```

Confirm the add/add_table helper pattern used throughout.

- [ ] **Step 2: Rewrite the effect decomposition section**

In `analysis/src/benchmark_analysis/reports/markdown.py`, replace the effect decomposition section (around lines 115-142):

```python
    # --- Effect Decomposition ---
    add("## Effect Decomposition")
    add()
    decomp = results.get("effect_decomposition", {})
    mechanisms = decomp.get("mechanism_attribution", [])

    if mechanisms:
        # Check if all mechanisms have the same value (uninformative)
        diffs = [m.get("associated_difference", 0) for m in mechanisms]
        all_same = len(set(round(d, 1) for d in diffs)) <= 1

        if all_same:
            add(f"_All {len(mechanisms)} mechanisms show identical associated difference "
                f"({diffs[0]:+.1f}) because the same conditions use all Twining tools. "
                f"See lite-vs-full comparison below for tool surface analysis._")
            add()
        else:
            headers = ["Mechanism", "Diff", "Avg Calls/Sess", "Heavy Users", "Non-Users"]
            rows = []
            for m in mechanisms:
                lift = m.get("associated_difference", 0)
                avg_calls = m.get("avg_calls_per_session", 0)
                heavy = ", ".join(m.get("heavy_user_conditions", [])) or "none"
                non = ", ".join(m.get("non_user_conditions", [])) or "none"
                rows.append([
                    m.get("mechanism", ""),
                    f"{lift:+.1f}",
                    f"{avg_calls:.1f}",
                    heavy,
                    non,
                ])
            add_table(headers, rows)

    # Lite vs Full comparison
    lvf = decomp.get("lite_vs_full", {})
    if lvf:
        add("### Lite vs Full Twining")
        add()
        add(f"| Metric | Value |")
        add(f"| --- | --- |")
        add(f"| twining-lite mean | {lvf.get('twining_lite_mean', 'N/A')} |")
        add(f"| full-twining mean | {lvf.get('full_twining_mean', 'N/A')} |")
        add(f"| delta (full - lite) | {lvf.get('delta', 'N/A'):+.1f} |")
        add(f"| conclusion | {lvf.get('conclusion', 'N/A')} |")
        full_only = lvf.get("full_only_tools", [])
        shared = lvf.get("shared_tools", [])
        if full_only:
            add(f"| full-only tools | {', '.join(full_only)} |")
        if shared:
            add(f"| shared tools | {', '.join(shared)} |")
        add()

    # Tool utilization
    util = decomp.get("tool_utilization", {})
    per_tool = util.get("per_tool_counts", [])
    if per_tool:
        add("### Tool Utilization")
        add()
        headers = ["Condition", "Tool", "Count"]
        rows = [[t["condition"], t["tool"], str(t["count"])] for t in per_tool]
        add_table(headers, rows)

    never = util.get("never_called", [])
    if never:
        add(f"**Never-called tools:** {', '.join(never)}")
        add()

    if not mechanisms and not lvf and not per_tool:
        add("_No effect decomposition data available._")
        add()
```

- [ ] **Step 3: Run Python tests**

```bash
cd analysis && .venv/bin/python -m pytest tests/test_effect_decomposition.py tests/test_reports.py -v
```

- [ ] **Step 4: Commit**

```bash
git add analysis/src/benchmark_analysis/reports/markdown.py
git commit -m "fix(analysis): render full effect decomposition with lite-vs-full and tool utilization

Previously only rendered the mechanism attribution table, which showed
identical values when all conditions use the same tools. Now also renders:
- lite-vs-full comparison (delta, conclusion, tool overlap)
- per-tool utilization counts by condition
- never-called tools list
- Collapsed note when all mechanisms are identical (uninformative)"
```

---

## Task 5: Fix Recommendations — Remove False Positives

**Problem:** The recommendations engine flags baseline and shared-markdown for "low engagement" — but those conditions are *designed* not to use Twining tools. It also flags "no statistically significant lift" as a coordination problem when it's actually a sample-size problem.

**Files:**
- Modify: `analysis/src/benchmark_analysis/dimensions/recommendations.py`

- [ ] **Step 1: Fix the engagement check to exclude non-coordination conditions**

In `analysis/src/benchmark_analysis/dimensions/recommendations.py`, the engagement loop (lines 18-26) should skip conditions that aren't expected to use Twining:

```python
    coord_entries = pc.values() if isinstance(pc, dict) else (pc if isinstance(pc, list) else [])
    for entry in coord_entries:
        if not isinstance(entry, dict):
            continue
        condition = entry.get("condition", "")
        # Only flag engagement for conditions that SHOULD use Twining
        if condition in ("baseline", "shared-markdown", "claude-md-only"):
            continue
        if entry.get("engagement_rate", 1.0) < 0.5:
            items.append({
                "priority": "high",
                "category": "coordination",
                "message": f"Fix activation: Twining engagement rate is {entry['engagement_rate']:.0%} for {condition} — agents aren't using coordination tools",
            })
```

- [ ] **Step 2: Improve the "no significant lift" recommendation**

Replace lines 100-107 to distinguish between "no effect" and "underpowered":

```python
    # Check coordination lift
    lift = all_results.get("coordination_lift", {})
    lift_summary = lift.get("summary", {})
    if lift_summary.get("overall_lift_significant") is False:
        # Check if there's a large effect that's just underpowered
        reliability = all_results.get("reliability", {})
        power_analyses = reliability.get("power_analysis", [])
        large_effects = [pa for pa in power_analyses
                         if abs(pa.get("cohens_d", 0)) >= 0.8
                         and abs(pa.get("cohens_d", 0)) < pa.get("mdes", 999)]
        if large_effects:
            items.append({
                "priority": "medium",
                "category": "coordination-lift",
                "message": f"Large coordination effects detected (d={max(abs(pa['cohens_d']) for pa in large_effects):.2f}) "
                           f"but study is underpowered to reach significance — increase sample size, not a coordination problem",
            })
        else:
            items.append({
                "priority": "high",
                "category": "coordination-lift",
                "message": "No statistically significant coordination lift detected — coordination tools may not be providing measurable value",
            })
```

- [ ] **Step 3: Run Python tests**

```bash
cd analysis && .venv/bin/python -m pytest tests/test_recommendations.py -v
```

- [ ] **Step 4: Commit**

```bash
git add analysis/src/benchmark_analysis/dimensions/recommendations.py
git commit -m "fix(analysis): remove false-positive recommendations for non-coordination conditions

- Skip engagement checks for baseline/shared-markdown (not expected to use Twining)
- Distinguish underpowered-but-large-effect from no-effect in lift recommendation"
```

---

## Task 6: Update Composite Weights

**Problem:** assumptionHandling carries 25% weight but (after Task 1 fix) will now have more variance. decisionConsistency also carries 25% but is the noisiest dimension. The weights should reflect measurement reliability.

**Files:**
- Modify: `src/scenarios/sprint-simulation.ts:611-616` (composite calculation)

- [ ] **Step 1: Rebalance weights**

New weights based on measurement characteristics:
- decisionConsistency: 0.20 (was 0.25) — high variance, reduced weight
- assumptionHandling: 0.20 (was 0.25) — graduated scoring will add variance
- cumulativeRework: 0.20 (unchanged) — solid measurement
- contextRecovery: 0.20 (was 0.15) — tightest measurement, most discriminating, deserves more weight
- finalQuality: 0.20 (was 0.15) — redesigned with more range, deserves more weight

Replace lines 611-616:

```typescript
    const composite =
      decisionConsistency.value * 0.20 +
      assumptionHandling.value * 0.20 +
      cumulativeRework.value * 0.20 +
      contextRecovery.value * 0.20 +
      finalQuality.value * 0.20;
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run --reporter=verbose
```

- [ ] **Step 3: Commit**

```bash
git add src/scenarios/sprint-simulation.ts
git commit -m "fix(scorer): rebalance composite to equal weights across 5 dimensions

With assumptionHandling graduated and finalQuality redesigned, all 5 dimensions
now have meaningful variance. Equal 20% weights until empirical data suggests
otherwise. contextRecovery and finalQuality increased from 15% to 20%;
decisionConsistency and assumptionHandling decreased from 25% to 20%."
```

---

## Task 7: Re-run Analysis and Verify

- [ ] **Step 1: Re-run analysis on the existing clean data with new scorers**

The scorer changes only affect future runs. To verify the effect decomposition and recommendation fixes work with existing data:

```bash
cd analysis && .venv/bin/benchmark-analysis analyze ../benchmark-results/6393b4ac-6988-4e2d-bc2d-f78cf5cafb46 --format all
```

- [ ] **Step 2: Verify the analysis report**

Check that:
- Effect decomposition now shows lite-vs-full comparison
- Recommendations don't flag baseline/shared-markdown engagement
- No "broken scorer" recommendation if assumptionHandling still shows zero variance in existing data (expected — the scorer fix only applies to future runs)

```bash
grep -A2 "Lite vs Full" ../benchmark-results/6393b4ac-6988-4e2d-bc2d-f78cf5cafb46/analysis/analysis.md
grep "Fix activation" ../benchmark-results/6393b4ac-6988-4e2d-bc2d-f78cf5cafb46/analysis/analysis.md
```

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run --reporter=verbose
cd analysis && .venv/bin/python -m pytest -v
```

- [ ] **Step 4: Commit any test fixes**

If any tests needed updating for the new scorer logic or weight changes, commit them.
