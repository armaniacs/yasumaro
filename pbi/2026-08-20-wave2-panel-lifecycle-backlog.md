# PBI Backlog: Dashboard Panel Lifecycle Migration Wave 2+

**Date:** 2026-08-20  
**Source:** Dashboard Panel Abstraction grilling + feature-dev Wave 1 implementation  
**Context:** Wave 1 (sqliteHistoryPanel) completed. This document plans Wave 2 (diagnosticsPanel) and beyond.

---

## Wave 2: diagnosticsPanel Migration

**PBI Template:** `2026-08-21-refactor-diagnostics-panel-lifecycle-migration.md`

| Priority | Metric | Value | Justification |
|----------|--------|-------|---|
| **Reach** | Panel usage frequency | High | Diagnostics is frequently opened during development/debugging |
| **Impact** | Interface clarity | High | 681-line god module → 1 seam (DiagnosticsCollector as deep module) |
| **Confidence** | Pattern confidence | High | Wave 1 establishes reusable pattern (init → load → destroy mapping) |
| **Effort** | 見積もり | 2 points (1-2 日) | Similar to Wave 1; slightly less controller complexity |

**Files Affected:**
- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts` (537 lines)
- `src/dashboard/main.ts` (1-line adapter removal)
- Test updates: 2 test files (DiagnosticsCollector.test.ts, diagnosticsPanel-builtInAi.test.ts)

**Acceptance Criteria:**
- ✓ diagnosticsPanel implements PanelLifecycle directly
- ✓ All existing tests pass
- ✓ New lifecycle tests added (~15-20 cases)
- ✓ npm run validate succeeds
- ✓ ADR recorded for Wave 2 learnings

**Pattern Checklist (from Wave 1):**
1. ✓ Identify panel (19 changes in past month — 2nd hotspot)
2. ✓ Create/adapt PanelLifecycle test file
3. ✓ Update panel return object (rename lifecycle methods)
4. ✓ Remove adapter wrapper in main.ts
5. ✓ Update all test files (type + method calls)
6. ✓ Run full test suite
7. ✓ Record learnings in next ADR

---

## Wave 3: Remaining Async-Data & Static-Form Panels

**Target panels (pending order by hotspot frequency):**

### Async-Data Panels
- `historyPanel.ts` (legacy, limited usage)
- `tagClusterPanel.ts` (used with sqliteHistoryPanel)
- `domainSearchPanel.ts` (domain filtering UI)
- `auditLogPanel.ts` (audit trail)

### Static-Form Panels
- `generalSettingsPanel.ts` (settings UI)
- `privacySettingsPanel.ts` (privacy settings)
- `aiSummaryCleansingPanel.ts` (AI output filtering settings)
- Remaining panels from `STATIC_FORM_PANELS` array

**Waves 3+ Strategy:**
- 1-2 panels per week sprint (based on Wave 1-2 velocity)
- Group by category (async-data, static-form) to share patterns
- Estimated completion: 4-6 weeks (11 panels × 1-2 points per wave)

---

## Post-Wave 3: Adapter Removal & Simplification

**Once all 11 panels migrated to PanelLifecycle:**

### Cleanup Tasks
1. Delete `adaptLegacyPanel()` function (types.ts)
2. Remove `AsyncDataPanel`, `StaticFormPanel`, `DiagnosticPanel` type exports (can keep as comments documenting legacy pattern)
3. Simplify NavigationRegistry comments (no adapter-specific logic notes)
4. Update AGENTS.md Panel abstraction section (document unified interface)

### Testing After Cleanup
- ✓ All 132+ tests still pass
- ✓ No panel imports adaptLegacyPanel
- ✓ NavigationRegistry operates on single PanelLifecycle interface

---

## Learnings from Wave 1 to Apply Wave 2+

### Test Migration Pattern
- **Mechanical steps:** Use sed/grep to batch-update test files
  ```bash
  sed -i '' 's/panel\.onActivate?\.$/panel.init?./g' file.test.ts
  sed -i '' 's/panel\.loadData()/panel.load?.()/g' file.test.ts
  sed -i '' 's/AsyncDataPanel/PanelLifecycle/g' file.test.ts
  ```
- **Time-saving:** ~10 min per panel for 2-5 test files

### Interface Mapping Consistency
- **init():** Always paired with load() in NavigationRegistry (order enforced)
- **destroy():** Called on deactivate OR unmount (full cleanup)
- **No optional hooks:** Keep mount/init/load/destroy required for consistent lifecycle

### ADR Documentation
- **Record in ADR:**
  - Why this panel (hotspot metric)
  - Interface mapping (unchanged from Wave 1)
  - Any new learnings (blockers, unexpected patterns)
  - Next panel recommendation

---

## Risk Mitigation

### Regression Risk: Medium → Low
- **Wave 1 mitigated:** Established pattern + 19 lifecycle tests confirm interface
- **Wave 2+ mitigation:** Reuse pattern checklist; run full test suite after each panel

### Breaking Change Risk: Low
- **NavigationRegistry compatibility:** No breaking changes to public API
- **Existing code:** All panel callers use NavigationRegistry (no direct lifecycle calls)
- **Test impact:** Mechanical updates only; logic unchanged

### Knowledge Transfer Risk: Low
- **Pattern documented:** ADR + pattern checklist + commit message
- **Effort tracking:** RICE scoring in this backlog
- **Sequential delivery:** One panel per week allows async handoff/documentation

---

## Dependencies & Ordering

**Mandatory order (single dependency chain):**
1. ✅ Wave 1: sqliteHistoryPanel (completed)
2. → Wave 2: diagnosticsPanel (no external dependencies; can start immediately)
3. → Wave 3a: historyPanel, tagClusterPanel (async-data cluster)
4. → Wave 3b: generalSettingsPanel, privacySettingsPanel (static-form cluster)
5. → Wave 3c: Remaining panels (low-change rate; can batch)
6. → Cleanup: adaptLegacyPanel removal

---

## Success Metrics

**Wave 1 (completed):**
- ✅ sqliteHistoryPanel migrated
- ✅ 132/132 tests passing
- ✅ ADR recorded
- ✅ Pattern established

**Wave 2+ targets:**
- Target: 4-6 weeks to complete all 11 panels
- Velocity: 1-2 panels per sprint (2 points each)
- Test coverage: Maintain 100% (all existing tests + lifecycle tests per panel)
- Regression: 0 breaking changes to public APIs
- Documentation: ADR per wave with learnings captured

---

## Implementation Timeline (Projected)

| Week | Waves | Panels | Status |
|------|-------|--------|--------|
| 2026-08-20 | Wave 1 | sqliteHistoryPanel | ✅ Complete |
| 2026-08-21 | Wave 2 | diagnosticsPanel | ⏳ Backlog |
| 2026-08-26 | Wave 3a | historyPanel, tagClusterPanel | ⏳ Backlog |
| 2026-09-02 | Wave 3b | generalSettingsPanel, privacySettingsPanel | ⏳ Backlog |
| 2026-09-09 | Wave 3c | Remaining panels (5) | ⏳ Backlog |
| 2026-09-15 | Cleanup | adaptLegacyPanel removal | ⏳ Backlog |

---

## References

- [ADR 2026-08-20: Panel Lifecycle Wave 1](../dev-docs/ADR/2026-08-20-panel-lifecycle-wave1.md)
- [Grilling Session Notes](../dev-docs/dig-findings-dashboard-panel-abstraction-wave1.md)
- [Panel Types Interface](../src/dashboard/panels/types.ts)
- [NavigationRegistry Implementation](../src/dashboard/panels/NavigationRegistry.ts)
