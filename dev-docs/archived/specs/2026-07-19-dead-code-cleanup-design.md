# Dead Code Cleanup Design

- Date: 2026-07-19
- Branch: `chore/dead-code-cleanup`
- Source: `tmp/DEAD_CODE_REPORT.md` (graphify AST-based dead code detection)

## Overview

Remove 10 dead code symbols identified by static analysis across 8 files.
No functional changes — all symbols are confirmed unreferenced by any production code, test, or runtime dispatch.

## Removal Targets

| # | Commit | File | Symbol | Lines | Note |
|---|--------|------|--------|-------|------|
| 1 | Low risk | `src/popup/errorUtils.ts` | `_isKnownError()` | L70-72 | `_` prefixed unused helper |
| 2 | Low risk | `src/popup/recordCurrentPage.ts` | `_resetRecordButtonAndClearFlag()` | L125-128 | `_` prefixed unused helper |
| 3 | Low risk | `src/popup/statusPanel.ts` | `_getRecordCurrentPage()` | L16-21 | `_` prefixed unused helper |
| 4 | Low risk | `src/utils/piiSanitizer.ts` | `_executeWithTimeout()` | L127-148 | `_` prefixed unused helper |
| 5 | Low risk | `src/utils/ublockMatcher.ts` | `_matchRule()` | L217-230 | `_` prefixed unused helper |
| 6 | Medium | `src/background/sqliteAlert.ts` | `getConsecutiveFailureCount()` | L58-60 | Exported, never imported |
| 7 | Medium | `src/dashboard/tagClusterPanel.ts` | `setActiveTag()` | L22-24 | Exported, never imported |
| 8 | Medium | `src/utils/promptSanitizer.ts` | `checkContentDangerLevel()` | L327-330 | Exported, never imported |
| 9 | High | `src/offscreen/opfsSpike.ts` | `runOpfsSpikeB()` | L89-197 | Spike code, never called. Other exports (`runOpfsSpikeA`, `runSpikeSteps`, interfaces) remain in use |
| 10 | Survey | `src/dashboard/dashboard.ts` | Breaking Changes modal subsystem | L747-796 | 5 symbols: `breakingChangesTrapId`, `BREAKING_CHANGES_SHOWN_KEY`, `getBreakingChangesElements()`, `showBreakingChangesModal()`, `closeBreakingChangesModal()` |

## Commit Plan

```
main
  └── chore/dead-code-cleanup
        ├── commit 1: chore: remove low-risk unused helper functions (#5-#8, #10)
        ├── commit 2: chore: remove unused exported public APIs (#1, #3, #9)
        ├── commit 3: chore: remove unused OPFS spike function (#4)
        └── commit 4: chore: remove unconnected Breaking Changes modal (#2)
```

## Verification

After each commit, run:

```bash
npm run type-check   # No type errors from removed imports
npm test             # All existing tests pass
npm run build        # Production build succeeds
```

No new tests needed — this is pure removal with no new functionality.

## Scope Boundaries

- **In**: 10 confirmed dead code symbols listed above
- **Out**: Any refactoring, renaming, or restructuring beyond removal
- **Out**: Modifying test files (test fixtures referencing removed DOM elements are harmless and left as-is unless they cause failures)
