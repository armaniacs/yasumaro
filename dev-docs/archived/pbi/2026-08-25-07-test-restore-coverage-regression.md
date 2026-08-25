# PBI: 削除されたテスト assertion を復元しカバレッジ回帰を解消する

## ユーザーストーリー
QA 担当者として、PBI アーカイブ化で削除されたテスト assertion を復元したい、なぜなら 12ファイルで 1500行以上のテストが削られ、branch coverage が低下したままでは将来のリファクタでリグレッションを検出できないから

## 優先度
- 順位: 8 / 9
- RICEスコア: 8.0（Reach=8 / Impact=1 / Confidence=60% / Effort=0.60w）
- 根拠: 影響は広いが Confidence が低く Effort が大。前段の 01-06 の修正が固まってから差分を測定すべきため後回し。

## ビジネス価値
- branch coverage を 80% 以上に回復し、将来の変更で例外系のデグレを即時検出できる
- 削除された dashboardSqliteHandlers の append/wiring 例外系が復活し、データ損失事故を防げる

## BDD受け入れシナリオ

```gherkin
Scenario: 削除前の coverage に回復する
  Given 現行の `vitest --coverage` で branch coverage が 75% である
  When 復元したテストを追加して再測定する
  Then branch coverage が 80% 以上になる

Scenario: dashboardSqliteHandlers の例外系が検出される
  Given sqliteClient がエラーを返す
  When dashboardSqliteHandler が append を呼ぶ
  Then エラーが適切にハンドリングされ、UI にエラー通知が出る

Scenario: CI でカバレッジ低下が検出される
  Given 将来の PR でテストを削除しようとする
  When CI の coverage ゲートを走らせる
  Then branch coverage が 80% を割ると CI が失敗する
```

## 受け入れ基準
- [ ] `vitest --coverage` の branch coverage が 80% 以上（現行との差分を PR に記載）
- [ ] 削除された 12ファイル（dashboardSqliteHandlers-append, dashboard-handlers, recordingConditionsSettings 等）の assertion が、`git diff main...HEAD --stat` で削除された分を精査し、必要なものが復元されている
- [ ] CI に coverage ゲート（80% 未満で失敗）が追加されているか、既存ゲートが有効である

## テスト戦略

### E2Eテスト
- ダッシュボードの履歴パネルで 1000件超のページングが正常に動作することを手動確認（以前の 1000件破綻 PBI の回帰）

### 統合テスト
- dashboardSqliteHandlers の append/wiring の例外系を復元

### 単体テスト
- 各削除ファイルの差分を `git diff` で洗い出し、消えた `expect` を 1件ずつ復元可否を判定

## 見積もり
5pt

## 技術的考慮事項
- 依存関係: 01-06 の修正後に実行（修正後のコードに対する coverage を測定するため）
- 非機能要件: テスト追加のみで本番コードは変えない

## 実装者向け注記

### 現状コードの確認
```bash
git diff main...HEAD --stat | grep __tests__
git diff main...HEAD -- src/background/__tests__/dashboardSqliteHandlers-append.test.ts | head -n 100
npm run test:coverage 2>&1 | tail -n 30
```

### 実装手順
1. `git diff main...HEAD --name-only | xargs git diff main...HEAD --stat` で削除行数が大きい 12ファイルを特定
2. `git show main:src/background/__tests__/dashboardSqliteHandlers-append.test.ts | wc -l` と現行を比較し、消えた `it(` / `expect(` を抽出
3. 必要な assertion を復元し、`vitest --coverage` で 80% を確認

### 落とし穴
- 単に旧ファイルを revert すると、PBI で意図的に整理したリファクタ（例: sqlite 統合）まで戻ってしまう。assertion 単位で必要なものだけを cherry-pick する
- coverage が 80% を超えても、例外系が 1件もないファイルが残る。branch だけでなく `expect` の数を `grep -c expect` で差分確認する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run test:coverage` が 80% 以上で PASS
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（CONTRIBUTING に coverage ゲートを追記）
