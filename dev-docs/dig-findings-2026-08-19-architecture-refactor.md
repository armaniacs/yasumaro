# Deep Dig Findings — Architecture Refactor (5 PBIs)

**Date:** 2026-08-19
**Scope:** Implement 5 architecture-deepening PBIs for Yasumaro Chrome extension
**Approach:** Self-guided why-why analysis (user requested autonomous derivation)

---

## Challenged assumptions and decisions

### Assumption 1: Delivery strategy

**Question:** Should all 5 PBIs be delivered in one PR or split?

**Why-why analysis:**
- Why one PR? → All PBIs are architecture refactors, so delivering together shows the complete picture.
- Why is one PR risky? → 5 PBIs touch storage, pipeline, cache, handlers, dashboard. A single regression could block everything and create a huge review burden.
- Why split? → Each PBI is independently testable and has clear boundaries. Independent PRs allow rollback of one without affecting the others.
- Why not split completely independently? → PBI-01 (settingsStore split) affects `createBackgroundServices.ts` and barrel exports, which PBI-03/04 also touch.
- Decision: **Independent PRs per PBI**, with explicit cross-PBI coordination notes in each PBI file. Implement in priority order (01 → 02 → 03 → 04 → 05).

**Decision:** PBIごとに独立PRに分けて進める。

---

### Assumption 2: Barrel file `storage.ts`

**Question:** Should `storage.ts` barrel be kept, migrated, or deleted?

**Why-why analysis:**
- Why delete? → It's marked `@deprecated` and hides real module dependencies.
- Why delete now? → 40+ consumers import through it. Migrating all at once would explode the scope of PBI-01.
- Why keep? → Backward compatibility and minimal disruption.
- Why keep indefinitely? → New code may continue using it, preventing real cleanup.
- Decision: **Keep the barrel as a re-export layer for this PR series**. Each PBI migrates only its direct consumers opportunistically. A future cleanup PR can remove the barrel once most consumers are migrated.

**Decision:** このPR群では `storage.ts` バレルを維持し、各PBIが直接影響する呼び出し元のみを新しいモジュールに移行する。バレル廃止は別の将来PBIとする。

---

### Assumption 3: `allowedUrls.ts` duplication

**Question:** How should the existing `allowedUrls.ts` be reconciled with the new `urlWhitelist.ts`?

**Why-why analysis:**
- Why does `allowedUrls.ts` exist? → It's a DI-based parallel implementation of `buildAllowedUrls`.
- Why not keep both? → Maintenance burden and risk of divergence.
- Why replace it with `urlWhitelist.ts`? → `urlWhitelist.ts` will be extracted from `settingsStore.ts` and use the typed `Settings` interface.
- Why not the other way around? → `settingsStore.ts` already has the canonical domain list and is the source of truth for AI provider domains.
- Decision: **Create `urlWhitelist.ts` as the canonical module**. Update `storageUrls.ts` barrel to export from `urlWhitelist.ts` instead of `allowedUrls.ts`. Delete or deprecate `allowedUrls.ts`.

**Decision:** `urlWhitelist.ts` を正規モジュールとし、`allowedUrls.ts` を削除または非推奨にする。

---

### Assumption 4: RecordingCache DI migration safety

**Question:** Will migrating 14 static call sites to DI break tests?

**Why-why analysis:**
- Why might tests break? → Tests may rely on `RecordingCache` static methods.
- Why do they rely on static methods? → Convenience and no need to set up `RecordingCacheInstance`.
- How to avoid breakage? → Update tests to use `InMemoryRecordingCacheStore` with `RecordingCacheInstance`.
- Why is this safe? → `InMemoryRecordingCacheStore` already exists for this purpose.
- Decision: **Update tests as part of PBI-03**. Add a test helper if needed to reduce boilerplate.

**Decision:** PBI-03 でテストも `InMemoryRecordingCacheStore` を使うよう更新する。必要に応じてテストヘルパーを追加する。

---

### Assumption 5: Handler dependency sub-interface compatibility

**Question:** Can `MessageHandlerRegistryDeps` be split without breaking existing tests?

**Why-why analysis:**
- Why might tests break? → Tests inject a full `MessageHandlerRegistryDeps` object.
- Why is that a problem? → TypeScript structural typing means an object with all fields still satisfies sub-interface requirements.
- Why not change to positional args? → That would break existing tests.
- Decision: **Keep `MessageHandlerRegistryDeps` as a union/extends of sub-interfaces**. Existing tests continue to inject full objects. Handler factories declare narrower sub-interface deps.

**Decision:** `MessageHandlerRegistryDeps` はサブインターフェースの union/extends にし、既存テストへの影響を最小化する。

---

### Assumption 6: Dashboard-SQLite shared validator placement

**Question:** Where should shared validators live?

**Why-why analysis:**
- Why in `messaging/`? → They validate messages crossing process boundaries.
- Why not `utils/`? → They are specific to the SQLite protocol shapes.
- Why not `dashboard/`? → SW side also needs them.
- Decision: **Place shared validators in `src/messaging/sqliteValidators.ts`** as pure functions with no chrome API dependency.

**Decision:** 共有バリデーターは `src/messaging/sqliteValidators.ts` に配置する。

---

### Assumption 7: Test coverage as safety net

**Question:** Will the existing test suite catch all regressions?

**Why-why analysis:**
- Why might it not? → Architectural refactors can preserve behavior while changing internal structure; existing tests may pass even if new modules are poorly designed.
- What additional safety is needed? → Add explicit tests for new module boundaries: no circular dependency, shared mapper field coverage, DI wiring correctness.
- Decision: **Each PBI must include at least one test that verifies the new architectural boundary** (e.g., import cycle test, mapper coverage test, DI injection test).

**Decision:** 各PBIに新しいアーキテクチャ境界を検証するテストを含める。

---

## Unresolved risks

- PBI-01 and PBI-04 both touch `createBackgroundServices.ts` — merge conflicts possible if worked in parallel. Mitigation: sequential PRs in priority order.
- PBI-05 changes `sqliteClient.ts` interface surface, which may ripple to `recordingPipeline` callers. Mitigation: keep public method signatures unchanged; only internal validation layer changes.

## Final decisions

1. Implement 5 PBIs as **independent PRs in priority order**.
2. Keep `storage.ts` barrel for this PR series; migrate direct consumers opportunistically.
3. Make `urlWhitelist.ts` canonical and remove/deprecate `allowedUrls.ts`.
4. Update tests to use `InMemoryRecordingCacheStore` in PBI-03.
5. Split `MessageHandlerRegistryDeps` into sub-interfaces while preserving the full-interface type for compatibility.
6. Place shared SQLite validators in `src/messaging/sqliteValidators.ts`.
7. Each PBI must include a boundary-verification test.
