# PBI03 実装計画

## Objective
order-dir の正規化と検証を `resolveOrderDir` に集約し、3 ビルダーの重複を除去する。

## Files Changed
- `src/offscreen/sqliteQueryBuilder.ts`
- `src/offscreen/__tests__/`

## Validation
`npx vitest run src/offscreen` — PASS（スコープ検証済み）。

## Rollback
ヘルパー抽出と呼び出し置換を戻せば、挙動不変の旧実装へ戻せる。
