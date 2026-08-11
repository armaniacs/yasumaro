# PBI: Dashboard の opfsMigrationV2* フィールドに decoder を適用する

## 種別
refactor / 既存実装の改善

## ユーザーストーリー

ダッシュボード利用者として、SQLite ステータスの `opfsMigrationV2*` フィールドが不正な値で失敗表示にならないことがほしい。なぜなら、診断パネルが初期化・移行状態を正しく伝達し、障害判断を誤らない必要があるから。

## 調査結果

着手前のコード確認:
- `src/dashboard/dashboardSqliteService.ts` の `getSqliteStatus()` は `initialized`, `path`, `fallback`, `fts5` を `requiredBoolean` / `requiredString` で厳密に decode している。
- 一方、`opfsMigrationV2Done`, `opfsMigrationV2LastAttemptedAt`, `opfsMigrationV2CompletedAt`, `opfsMigrationV2RecordCount` は response から素通ししている。
- `src/background/handlers/dashboardSqliteProtocol.ts` の型定義は `opfsMigrationV2Done?: boolean`, `opfsMigrationV2LastAttemptedAt?: string | null` 等である。
- `src/offscreen/offscreen.ts` は `items[StorageKeys.OPFS_MIGRATION_V2_*]` を返却する。

実現可能性: **高**。`dashboardSqliteService.ts` の `getSqliteStatus()` に `requiredBoolean` / `optionalString` / `requiredNumber` を適用する。

## 5 Whys

1. なぜ opfsMigrationV2* が素通しなのか。主要フィールドの decoder 導入後に追加され、専用 decoder が用意されなかったから。
2. なぜ主要フィールドは decoder があるのか。PBI 2026-08-10-01（Dashboard SQLite 結果契約）で `ServiceResult` 移行と decoder 整備が実施されたから。
3. なぜ opfsMigrationV2* が対象外だったのか。status 経路は成功時のみ利用され、失敗時は `initError` で表現されると判断されたから。
4. なぜ decoder が必要なのか。off-screen の応答が不正な shape を返した場合、`undefined` / `null` / `NaN` / 負数が UI へ伝播し、診断表示が崩れるリスクがあるから。
5. なぜ壊れた表示が問題なのか。ユーザーが OPFS 移行の失敗を「成功」や「未実行」と誤認する可能性があるから。

根本原因: `getSqliteStatus` の decoder 適用範囲が主要フィールドに留まり、`opfsMigrationV2*` 系が未適用のまま恒久化した。

## BDD受け入れシナリオ

```gherkin
Scenario: opfsMigrationV2Done が厳密に decode される
  Given off-screen が opfsMigrationV2Done に boolean を返す
  When Dashboard が status を decode する
  Then boolean として取得成功する

Scenario: opfsMigrationV2LastAttemptedAt が厳密に decode される
  Given off-screen が opfsMigrationV2LastAttemptedAt に文字列または null を返す
  When Dashboard が status を decode する
  Then 文字列または null として取得成功する

Scenario: opfsMigrationV2RecordCount が厳密に decode される
  Given off-screen が opfsMigrationV2RecordCount に非負数を返す
  When Dashboard が status を decode する
  Then 非負数として取得成功する
```

## 受け入れ基準
- [ ] `opfsMigrationV2Done` が `requiredBoolean` で decode される。
- [ ] `opfsMigrationV2LastAttemptedAt` が `optionalString` で decode される。
- [ ] `opfsMigrationV2CompletedAt` が `optionalString` で decode される。
- [ ] `opfsMigrationV2RecordCount` が `requiredNumber`（非負数）で decode される。
- [ ] 不正な値（`NaN`、負数、オブジェクト等）が成功表示にならない。
- [ ] 既存の診断パネル表示が維持される。
- [ ] `npm run type-check` と関連テストが成功する。

## テスト戦略（TDD）

### Outside-In手順
1. `dashboardSqliteService` の status decode テストに、opfsMigrationV2* の境界ケース（`undefined`, `null`, `NaN`, `-1`, オブジェクト）を Red で追加する。
2. decoder を適用し Green にする。

### 単体テスト
- `opfsMigrationV2Done`: `true` / `false` / `undefined` の境界。
- `opfsMigrationV2LastAttemptedAt`: 有効な文字列 / `null` / `undefined`。
- `opfsMigrationV2CompletedAt`: 同上。
- `opfsMigrationV2RecordCount`: `0` / 正数 / `NaN` / `-1` / `undefined`。

### 統合テスト
- `getSqliteStatus()` の戻り値が型契約に一致する。

## 実装手順

1. `dashboardSqliteService.ts` の `getSqliteStatus()` 内で、opfsMigrationV2* 各フィールドに既存 decoder を適用する。
2. 必要に応じて `optionalString` 等のヘルパーを追加または再利用する。
3. 単体テストを追加・更新する。
4. `npm run type-check` と `npm run validate` を実行する。

## 見積もり
**1ポイント**（🟢低）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装され、成功する。
- [ ] `opfsMigrationV2*` 各フィールドが厳密に decode される。
- [ ] 不正値が成功表示にならないことがテストで固定されている。
- [ ] `npm run type-check` が成功する。
- [ ] `npm run validate` が成功する。
- [ ] 既存の診断パネル表示が維持される。
