# PBI: Diagnostics panel の判定ロジックをrenderから分離

## ユーザーストーリー
拡張機能の開発者として、診断パネルの移行ステータス判定ロジック（成功/失敗/未着手/チェック中の判断）を DOM描画から独立した純粋関数として扱いたい、なぜなら現在 `renderMigrationSection` は約120行にわたりDOM組み立てとドメイン判定（`opfsNotApplicable`・`opfsChecking`・`opfsWarn`・`allDone` 等）を混在させており、jsdomを通さないとロジックの単体テストができないため。

## 優先度
- 順位: 03 / 4
- RICEスコア: 1.0（Reach=開発者のみ(月数回の変更頻度) × Impact=1 × Confidence=100% / Effort=1人日）
- 根拠: ユーザー影響はないが、テスト容易性向上の効果は確実で実装コストも小さい。依存関係なし。

## 制約
- 表示内容・DOM構造は変更しない（リファクタのみ、視覚的な差分ゼロ）
- `DiagnosticsCollector.collect()` が返す `DiagnosticsSnapshot` の型は変更しない

## BDD受け入れシナリオ

```gherkin
Scenario: OPFS移行が完了している場合のステータスが正しく導出される
  Given DiagnosticsSnapshot.sqlite が OPFS移行完了を示す値を持つ
  When deriveMigrationStatus(snapshot.sqlite) を呼び出す
  Then overall が "done" として返される

Scenario: OPFS移行が対象外の環境でステータスが正しく導出される
  Given DiagnosticsSnapshot.sqlite が OPFS非対応環境を示す値を持つ
  When deriveMigrationStatus(snapshot.sqlite) を呼び出す
  Then overall が "not-applicable" として返される（失敗として誤判定されない）

Scenario: renderMigrationSection が導出済みステータスをそのまま描画する
  Given deriveMigrationStatus の戻り値が確定している
  When renderMigrationSection(el, snap) を呼び出す
  Then DOM組み立てのみを行い、判定ロジックを含まない
```

## 受け入れ基準
- [x] `deriveMigrationStatus(sqlite: DiagnosticsSnapshot['sqlite']): { overall, opfs, idb, hints[] }` が純粋関数として `diagnosticsPanel.ts` から切り出される
- [x] `renderMigrationSection` が `deriveMigrationStatus` の戻り値をDOMにマッピングするだけの関数になる
- [x] 既存の診断パネルE2Eテスト（見た目・表示内容）が変更なくパスする
- [x] `deriveMigrationStatus` に対するjsdom不要の単体テストが追加される（10件）

## テスト戦略
- E2E: 既存の診断パネル表示確認フローをそのまま再実行し回帰がないことを確認
- 統合: なし（純粋関数抽出のためレンダリング層との結合テストは既存E2Eで代替）
- 単体: `deriveMigrationStatus` の境界値（完了/未着手/チェック中/対象外/エラー）を網羅

## 見積もり
2ポイント（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
