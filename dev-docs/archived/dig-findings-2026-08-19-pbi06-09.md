# Deep-Dig Findings: PBI06-PBI09 Implementation

Date: 2026-08-19
Scope: Implement PBI06 through PBI09 sequentially

## Challenged Assumptions

### PBI06: visitRateLimiter TTL Sweep

| Assumption | Risk | Finding | Decision |
|---|---|---|---|
| O(n) sweep of 1000 entries is negligible per call | Medium | Called on every VALID_VISIT; hostile page could theoretically keep Map at cap | Accept with benchmark guard: median < 50ms on 1000 entries, per PBI spec. Revisit implementation if threshold exceeded. |
| Map iteration with concurrent delete is safe | Low | ECMAScript Map spec permits deletion during iteration | Keep current pattern, move sweep before get/set to avoid subtle ordering issues. |
| TTL sweep must run on every call | Low | PBI explicitly requires unconditional sweep to honor existing comment | Implement unconditional sweep; keep MAX_ENTRIES safeguard after set. |

### PBI07: promptSanitizer Bypass Hardening

| Assumption | Risk | Finding | Decision |
|---|---|---|---|
| Regex can correctly identify closed HTML attributes | High | The PBI's sample regex is ReDoS-vulnerable | Do NOT use the sample regex. Implement a procedural parser that scans backward from index to determine whether the match is inside a quoted/unquoted attribute value. |
| Shrinking safe-marker window to 8 chars preserves < 20% false-positive rate | Medium | Existing test `promptSanitizer-false-positives.test.ts` measures this | Implement with 8-char window; run existing corpus test; if false positives rise, tune window or marker set before merging. |
| Japanese safe markers improve coverage without becoming bait | Medium | Japanese compound words can still be intentionally placed near injection text | Add only 3-8 char compound markers (e.g., 注意喚起, 対策例, 攻撃手法). Document that adaptive attackers can still bypass. |
| `isInSafeContext` is called with consistent index | Medium | Stage 1 uses `sanitized`, Stage 2 uses `decodedContent` index for `isMaliciousUsage` | For PBI07, focus on `isInSafeContext` in Stage 1 where content/index are consistent. |

### PBI08: isMaliciousUsage Danger Level Ignored

| Assumption | Risk | Finding | Decision |
|---|---|---|---|
| LOW should trigger some defensive action | Medium | All callers check only HIGH, making LOW detection effectively dead code | Choose candidate (a) "structured logging only" as the safest incremental step. Add a dedicated log field/category so detections are observable and searchable without blocking benign content. |
| All callers should treat LOW uniformly | Medium | Different callers have different contexts (user prompt validation vs AI output sanitization) | Add LOW logging consistently, but do not block/alter behavior except for optional metrics. Keep HIGH behavior unchanged. |
| PBI07 must merge before PBI08 | High | Both touch `promptSanitizer.ts` adjacent areas | Sequence: implement and merge PBI07 first, then PBI08 in a fresh branch rebased on main. |

### PBI09: DoD Enforcement Mechanism

| Assumption | Risk | Finding | Decision |
|---|---|---|---|
| Mechanical test-presence check improves DoD adherence | Medium | File-level checks miss "test exists but new logic is uncovered" cases | Implement a lightweight CI warning job that checks (a) source diff without test diff, (b) test-case count delta, (c) lines-changed-but-count-flat pattern. Document limitations explicitly. |
| GitHub Actions path filters can be reused for diff detection | Low | Existing `pages.yml` uses `src/**/*.ts` path filter successfully | Use `git diff --diff-filter=ACM <base>...HEAD` with Node.js `glob`/`minimatch` in CI, not shell `**`. |
| Warning-level job won't slow team | Low | New job runs only on PRs | Add as a separate non-blocking job in `ci.yml`. |

## Newly Discovered Risks

1. **PBI06 performance regression on shared CI runners**: The 50ms threshold is intentionally loose, but CPU-throttled runners could still occasionally exceed it. Use median of 3 runs and mark test as potentially flaky if environment is highly variable.
2. **PBI07 procedural parser edge cases**: Unquoted attributes, boolean attributes, and malformed HTML must be handled. Parser should be conservative: if uncertain, treat as unsafe (i.e., do NOT consider it safe context).
3. **PBI08 log volume**: GENERIC_TERM_PATTERNS match common words. Logging every LOW detection could fill the 100-entry pending log buffer quickly. Mitigate by deduplicating identical warnings within a single sanitize call or by using a dedicated low-priority log type.
4. **PBI09 false positives**: Refactors that move code without changing behavior may trigger "source changed but test didn't" warnings. Keep job as warning-only and allow suppression via PR label or comment.

## Unresolved Questions (to be resolved in Phase 3/4b)

1. PBI08: Confirm candidate (a) "structured logging only" is acceptable, or prefer candidate (b)/(c).
2. PBI07: Final set of Japanese safe markers (must be 3-8 chars and pass false-positive corpus test).
3. PBI09: Whether to add the DoD warning job to `ci.yml` as a separate job or extend the existing `validate` job.

## Decisions Already Made

1. PBI06: Unconditional TTL sweep before get/set; keep MAX_ENTRIES safeguard after set; benchmark threshold 50ms median.
2. PBI07: Procedural HTML-attribute parser (no ReDoS-prone regex); safe-marker window 8 chars; add 3-8 char Japanese compound markers.
3. PBI08: Sequence after PBI07; implement structured logging for LOW detections only.
4. PBI09: Warning-level CI job using Node.js-based diff analysis; update PBI template with rollback-consideration item.
