# PBI10 実装計画

## Objective
recording trigger の raw storage 読み取りキーを migration allowlist と整合させ、死蔵 write API を削除する。

## Files Changed
- `src/utils/storage/settingsMigration.ts`
- `src/utils/storage/__tests__/settingsMigration-completion-state.test.ts`
- `src/background/recordingTriggerManager.ts`

## Validation
`npx vitest run src/utils/storage` — PASS（スコープ検証済み）。

## Rollback
allowlist の2キー変更と write API 削除を戻せばロールバックできる。
