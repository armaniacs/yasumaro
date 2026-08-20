# ADR: Dashboard Panel Lifecycle Migration — Wave 1 (sqliteHistoryPanel)

**Date:** 2026-08-20  
**Status:** Implemented  
**Scope:** sqliteHistoryPanel direct implementation of PanelLifecycle interface

---

## Problem

Dashboard panels currently use legacy interfaces (AsyncDataPanel, StaticFormPanel, DiagnosticPanel) and are wrapped by `adaptLegacyPanel` adapter to conform to the new `PanelLifecycle` interface. This two-layer approach adds complexity:

1. **Interface fragmentation**: 11 panels still implement legacy interfaces
2. **Adapter maintenance**: `adaptLegacyPanel` maintains mapping logic for 3 legacy interfaces
3. **Testing burden**: Tests need to account for adapter behavior
4. **Scalability**: Adding new panels requires adapter support

The goal is to gradually migrate panels to direct PanelLifecycle implementation, starting with the most-changed panels (hotspots).

---

## Solution

**Phase 1 (Wave 1 — this ADR): sqliteHistoryPanel direct implementation**

Convert sqliteHistoryPanel from AsyncDataPanel to PanelLifecycle interface directly:

```typescript
// Before: AsyncDataPanel interface
{
  id: string,
  category: 'async-data',
  mount(container): void,
  loadData(): Promise<void>,
  unmount(): void,
  onActivate(init?): void,
}

// After: PanelLifecycle interface
{
  id: string,
  category: 'async-data',
  mount(container): void,
  init(initParams?): void,
  load(): Promise<void>,
  destroy(): void,
}
```

**Interface mapping:**
- `mount()` → `mount()` (unchanged)
- `loadData()` → `load()` (method rename, async semantics preserved)
- `onActivate()` → `init()` (initialization entry point)
- `unmount()` → `destroy()` (lifecycle cleanup)

**Rationale:**
- sqliteHistoryPanel is the most-changed panel (26 changes in past month) — highest benefit from direct implementation
- Existing tests (10 files, 113 test cases) provide strong regression safety
- No architectural changes; only interface remapping at the boundary

---

## Constraints & Risks

### Constraints
1. **Backward compatibility**: Existing 10 panels remain on adapter pattern until Wave 2-3
2. **Interface consistency**: init() and load() are required (not optional like other lifecycle methods) to match current behavior
3. **Test coverage**: All existing tests must pass without modification to lifecycle logic

### Risks
1. **Regression in lifecycle ordering**: If `init()` is called after `load()`, pending initialization parameters may be consumed prematurely
   - **Mitigation**: NavigationRegistry controls the order (init before load). Verified in lifecycle integration tests.

2. **Incomplete cleanup**: destroy() must cover all unmount() responsibilities
   - **Mitigation**: debounce timer cleanup, generation bump, selection clear — all preserved. Verified in destroy tests.

3. **Parameter type drift**: init(initParams?: Record<string, unknown>) is less type-safe than specific params
   - **Mitigation**: Runtime checks for searchTag/searchDomain. PanelInitMap in types.ts provides typed navigation.

---

## Implementation

### Files Changed
1. **src/dashboard/panels/asyncData/sqliteHistoryPanel.ts**
   - Import: AsyncDataPanel → PanelLifecycle
   - Function signature: returns PanelLifecycle
   - Return object: rename lifecycle methods (load, init, destroy)
   - Comments: update references to new method names

2. **src/dashboard/main.ts**
   - Remove adaptLegacyPanel() wrapper: `adaptLegacyPanel(createSqliteHistoryPanel())` → `createSqliteHistoryPanel()`

3. **Test files (10 existing test files)**
   - Update panel type: AsyncDataPanel → PanelLifecycle
   - Update method calls: onActivate → init, loadData → load

### Files Added
1. **src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel.lifecycle.test.ts**
   - 19 test cases covering:
     - Interface compliance (id, category, methods present)
     - mount() initialization
     - init() parameter handling (searchTag, searchDomain)
     - load() async behavior
     - destroy() cleanup
     - Lifecycle sequence validation (mount → init → load → destroy)

---

## Testing

**Existing tests:** 113 test cases, all passing
- Generation race guard (3 tests)
- Pagination (3 tests)
- Sort control (5 tests)
- Tag fallback (6 tests)
- Write errors (3 tests)
- View rendering (5 tests)
- Query logic (10 tests)
- State management (10 tests)
- Controller behavior (30+ tests)

**New tests:** 19 lifecycle-specific test cases
- Interface compliance (3 tests)
- mount() behavior (2 tests)
- init() parameter handling (5 tests)
- load() async behavior (3 tests)
- destroy() cleanup (3 tests)
- Sequence validation (3 tests)

**Test result:** 132/132 passing

---

## Wave 2+ Planning

**Next panels (diagnosticsPanel):**
- 19 changes in past month — second hotspot
- Similar lifecycle pattern (async data loading + cleanup)
- Same mapping: DiagnosticPanel → PanelLifecycle
- Expected: 1-2 day effort per panel

**Pattern checklist (for Wave 2+):**
1. ✓ Identify panel hotspot (git commit frequency)
2. ✓ Create/adapt PanelLifecycle test file
3. ✓ Update panel return object (rename lifecycle methods)
4. ✓ Remove adapter wrapper in main.ts
5. ✓ Update all test files (type + method calls)
6. ✓ Run full test suite
7. ✓ Record learnings in next ADR

---

## Decisions Recorded

1. **Sequence of implementation:** Wave 1 (sqliteHistoryPanel) → Wave 2 (diagnosticsPanel) → Wave 3+ (remainder)
   - **Why:** Hotspot-driven: highest-changed panels first to demonstrate pattern with real experience
   - **Alternative rejected:** Bulk migration risks regression; sequential allows learning from each panel

2. **Interface mapping:** init() always called before load() by NavigationRegistry
   - **Why:** Ensures initialization parameters are available during load()
   - **Verified by:** lifecycle integration tests + NavigationRegistry implementation review

3. **Test strategy:** Lifecycle tests added, existing tests updated (not rewritten)
   - **Why:** Preserves regression coverage from business logic tests; new lifecycle tests verify interface contract
   - **Benefit:** Low-risk, composable testing approach

---

## Acceptance Criteria

✅ sqliteHistoryPanel implements PanelLifecycle directly (no adapter)  
✅ All 132 tests pass (113 existing + 19 new lifecycle tests)  
✅ npm run type-check succeeds (TypeScript strict mode)  
✅ adaptLegacyPanel() wrapper removed for this panel in main.ts  
✅ No breaking changes to NavigationRegistry or other modules  
✅ ADR recorded for future reference during Wave 2+

---

## Related Decisions

- **2026-07-13-architecture-phase2-deep-dig.md:** Panel abstraction interface definition (completed in types.ts)
- **NavigationRegistry.ts:** Lifecycle orchestration (mount → init → load → destroy sequence)
- **PanelLifecycle interface (types.ts):** Canonical lifecycle definition for all panels
