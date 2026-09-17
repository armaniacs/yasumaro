# PBI: DashboardSqliteValidator の per-subtype if-chain を宣言的 schema テーブルに寄せ、archive_query 上限を limits.ts に収録する

優先度: 順位 2 / 3（RICE: 2.4 = Reach 3 / Impact 1 / Confidence 0.8 / Effort 1 pt）
backlog: [2026-09-17-00-backlog-archloop-0917.md](2026-09-17-00-backlog-archloop-0917.md)（台帳）
依存: なし

## ユーザーストーリー

保守担当者として、新しい DASHBOARD_SQLITE subtype を追加するときに validation を 1 箇所のテーブル行として書けると嬉しい。なぜなら `validators.ts` の `DashboardSqliteValidator.validate()` が per-subtype の if-chain（約 85 行）で、同一の `decodeStagingName` try/catch が同一関数内に 6 回複製され、文言も 6 流儀に分裂しているから。

## 背景（現状と課題）

- `src/messaging/validators.ts:205-289` — archive 系 subtype の検査が if-chain。`try { decodeStagingName(p.stagingName) } catch { throw new ValidationError(...) }` の同一ブロックが `archive_export` / `archive_delete_by_staging` / `archive_open|save|close|restore_preview|restore` / `archive_query` / `archive_update` の 6 箇所に複製。
- `archive_query` の `limit 1..500` が limits.ts の上限レジストリ外の literal（PBI 2026-09-11-08 が駆除した「limits.ts 外の上限」の同型再発）。`MAX_TITLE_LENGTH = 500` とは無関係の別概念。
- 上限 drift ガード（`limits-drift.test.ts` 系）は limits.ts を参照する形でのみ機能する。

## BDD受け入れシナリオ

```gherkin
Scenario: stagingName を要求する subtype は単一の検査経路を通る
  Given STAGING_NAME_SUBTYPES に登録された subtype の payload を検証する
  When stagingName が不正である
  Then ValidationError が subtype 名つきの統一文言で送出される

Scenario: archive_query の上限は limits.ts 参照である
  Given archive_query の limit 検査を確認する
  Then 上限値は limits.ts の定数から派生し、literal 直書きが存在しない

Scenario: 既存の validation 挙動は不変
  Given 全 subtype の正常/異常 payload
  When validate を実行する
  Then 修正前のテストが無修正でパスする
```

## 受け入れ基準

- [x] `STAGING_NAME_SUBTYPES` セット + 共有検査 1 箇所に集約し、6 重 try/catch を削除
- [x] `MAX_ARCHIVE_QUERY_LIMIT`（=500）を `src/messaging/limits.ts` に新設し、validators から参照する
- [x] per-subtype 必須フィールド検査を field-spec テーブル（subtype → fields）に寄せ、if-chain を縮小する（cutoff / staging の専用ガードは維持）
- [x] 既存 validators テストが無修正でパス（挙動不変の pin）

## テスト戦略

- 単体: 既存 `validators` 系テストの無修正パスを回帰 pin とする
- 単体: STAGING_NAME_SUBTYPES の網羅性テスト（テーブル外に stagingName を要求する subtype が無いこと）
- 単体: limits 参照の drift pin（literal が再発したら検出）

## 見積もり

1 pt（🟢低）— 同一ファイル内の構造整理 + 定数 1 件の移動。

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新不要（内部実装の修正のみ）
