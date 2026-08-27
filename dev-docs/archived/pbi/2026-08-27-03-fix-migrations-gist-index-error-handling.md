# PBI: migrations GIST index の広い catch 修正

## ユーザーストーリー
開発者として、GIST index 作成失敗時に `database locked` / `disk I/O` を握り潰さずに検出したい、なぜなら黙殺すると後続クエリで `no such column: gist_synced` が静かに発生しデバッグが困難になるから。

## 優先度
- 順位: 3 / 8
- RICEスコア: 480（Reach=30 / Impact=2 / Confidence=80% / Effort=0.1）
- 根拠: マイグレーションは全インストールで 1 回走る (Reach=30)。失敗黙殺はデータ不整合に直結 (Impact=2)。`ALTER TABLE` 側は正しく `duplicate column name` のみ無視しており不整合が明確。

## なぜなぜ分析
- なぜ黙殺されるか: `try { exec(GIST_SYNCED_INDEX_SQL) } catch {}` が全例外を無視するため
- なぜ広くしたか: `already exists` を無視する意図で catch を書いたが条件を絞らなかった
- なぜテストが気づかないか: 包括テストが `database locked` でも `resolves` を期待し誤りを固定した
- 解: `already exists` / `duplicate` のみ無視し、それ以外は再 throw またはリトライに回す

## BDD受け入れシナリオ
Scenario: ハッピーパス — 既存 index は無視して続行
  Given DB に `idx_logs_gist` が既に存在する
  When `runMigrations` を実行する
  Then `already exists` は無視され `fts5Available` が正しく返る

Scenario: 異常系 — database locked は握り潰されない
  Given `exec(GIST_SYNCED_INDEX_SQL)` が `database locked` で失敗する
  When `runMigrations` を実行する
  Then エラーは再 throw され、呼び出し側がリトライまたは失敗を検出できる

## 受け入れ基準
- [x] `src/offscreen/migrations.ts:21-25` の catch が `already exists` / `duplicate` のみに限定されている
- [x] `src/offscreen/__tests__/migrations-comprehensive.test.ts:176` が `resolves` ではなく `rejects` を期待する形に修正されている
- [x] `sqlite-migration-errors.test.ts` と挙動が一致する
- [x] 既存 208 ケースがパスする

## テスト戦略
- 単体: `runMigrations` に `already exists` / `database locked` / `disk I/O` を注入し分岐を検証
- 統合: IDB 実 DB でのマイグレーション冪等性テスト
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
