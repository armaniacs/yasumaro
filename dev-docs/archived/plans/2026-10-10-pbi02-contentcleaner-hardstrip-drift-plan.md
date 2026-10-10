# PBI02 実装計画

## Objective
hard-strip の収集処理を共有化し、hidden 要素の recount と実際の除去数を一致させる。

## Files Changed
- `src/utils/contentCleaner.ts`
- `src/utils/__tests__/contentCleaner*.test.ts`

## Validation
`npx vitest run src/utils` — PASS（スコープ検証済み）。

## Rollback
収集ヘルパー統合差分を戻せば旧挙動へ復旧できる。
