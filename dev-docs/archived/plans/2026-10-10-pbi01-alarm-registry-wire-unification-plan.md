# PBI01 実装計画

## Objective
alarmRegistry の依存配線を composition root の DI に統一し、module-level refs と不要な型キャストを除去する。

## Files Changed
- `src/background/alarmRegistry.ts`
- `src/background/alarmRegistryRefs.ts`（削除）
- `src/background/compositionManifest.ts`
- `src/background/service-worker.ts`
- `src/background/__tests__/alarmRegistry*.test.ts`
- `src/background/__tests__/service-worker.test.ts`
- `LAYERS.md`

## Validation
`npx vitest run src/background` — PASS（スコープ検証済み）。

## Rollback
配線変更のみのため、関連差分を戻せば復旧できる。
