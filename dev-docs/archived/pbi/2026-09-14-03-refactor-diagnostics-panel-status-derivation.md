# PBI: 診断パネルの移行ステータス判定をピュア関数に分離

## ユーザーストーリー
拡張機能の開発者として、`diagnosticsPanel.ts` の `renderMigrationSection` からOPFS/IDB移行ステータスの判定ロジックを独立したピュア関数として切り出したい。なぜなら、現状はDOM組み立てとドメイン判定（`opfsNotApplicable`・`opfsChecking`・`opfsWarn`・`allDone`等）が混在しており、jsdomを経由しないと判定ロジック単体のテストができないため。

## 優先度
- 順位: 単発（保守性改善のリファクタ、機能追加なし）
- 根拠: `renderMigrationSection`（約120行）はPBI 2026-08-27-02以降、繰り返し拡張されてきており、判定条件（done/notApplicable/checking/warn）が複雑化している。ロジックをDOM操作から切り離すことで、今後の条件追加やバグ修正がjsdom不要な単体テストで検証できるようになる。

## 制約
- `DiagnosticsCollector.collect()` が返す `DiagnosticsSnapshot` の型は変更しない
- 既存の診断パネルの表示内容・DOM構造は変更しない（視覚的な差分ゼロ）
- 既存の `diagnosticsPanel.migration.test.ts`（jsdom経由の統合テスト）は無変更でパスすること

## 受け入れ基準
- [x] `deriveMigrationStatus(sqlite: DiagnosticsSnapshot['sqlite']): { overall, opfs, idb, hints[] }` が純粋関数として切り出されている
- [x] `renderMigrationSection` が `deriveMigrationStatus` の戻り値をDOMにマッピングするだけの関数になっている
- [x] 既存の診断パネルの表示内容・DOM構造が変更されていない（視覚的な差分ゼロ）
- [x] `deriveMigrationStatus` に対するjsdom不要の単体テストが追加されている

## テスト戦略
- 単体: `src/dashboard/panels/diagnostic/__tests__/deriveMigrationStatus.test.ts`（jsdom環境指定なし）。done/notApplicable/checking/warnの全組み合わせをカバー
- 統合: 既存の `diagnosticsPanel.migration.test.ts`（jsdom経由）が無変更でパスすることをリファクタの回帰確認とする

## 見積もり
1pt（既存ロジックの切り出しのみ、新規動作追加なし）

## Definition of Done
- [x] 受け入れ基準の全項目を満たす
- [x] `npm run type-check` がPASSする
- [x] dashboard関連のユニットテストが全てPASSする（既存の診断パネルのテストを含む）
- [x] コードレビュー完了
