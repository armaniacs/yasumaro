# PBI: デッドコード化した旧SQLite履歴パネルの削除

## ユーザーストーリー
開発チームとして、実行時に到達しない旧バージョンの履歴パネルコードを削除したい、なぜなら保守時に「どちらが本物のコードか」を都度調査するコストが発生しており、誤って旧コードを修正してしまうリスクもあるから

## ビジネス価値
- 約1330行のデッドコード（実装2ファイル + テスト5ファイル）を除去し、コードベースの認知負荷を下げる
- 誤修正リスク（旧ファイルを本物と誤認して直す）をゼロにする
- 直接のユーザー向け機能変化はなし（内部整理のみ）

## 実装者向け注記（フェーズ0の既実装確認結果）

grep によるリポジトリ横断調査済み。以下を確認済み:
- `src/dashboard/main.ts:7-8` は `./panels/asyncData/historyPanel.js` と `./panels/asyncData/sqliteHistoryPanel.js` のみをimportし、`DashboardBootstrapper.registerPanels()`（main.ts:26-32）に登録している。**これが実行時の唯一のアクティブ版**
- トップレベル `src/dashboard/sqliteHistoryPanel.ts`（1149行）はプロダクションコードから一切参照されていない
- トップレベル `src/dashboard/historyPanel.ts`（180行）は `sqliteHistoryPanel.ts` から `searchForTagInSqliteHistory` をimportしているのみで、こちらもプロダクションコードから未参照
- 参照しているのはテスト5本のみ（下記削除対象）

```bash
# 削除前の再確認コマンド（念のため実施すること）
grep -rn "from.*['\"].*/sqliteHistoryPanel['\"]" src/ --include="*.ts" | grep -v __tests__
grep -rn "from.*['\"].*/historyPanel['\"]" src/ --include="*.ts" | grep -v __tests__ | grep -v "panels/asyncData"
```

## BDD受け入れシナリオ

```gherkin
Scenario: デッドコード削除後もダッシュボードのSQLite履歴パネルが正常動作する
  Given ダッシュボードを開いている
  When SQLite履歴パネルを表示する
  Then パネルが正常にレンダリングされ、既存の検索・タグ絞り込み機能が動作する

Scenario: ビルドとテストが削除後も成功する
  Given トップレベルの sqliteHistoryPanel.ts / historyPanel.ts とその専用テスト5本を削除した状態
  When `npm run build` を実行する
  Then ビルドが成功する
  When `npm run type-check` を実行する
  Then 型エラーが発生しない
  When `npm test`（vitest run）を実行する
  Then 削除した5テストファイル分だけテスト数が減るが、残る全テストはパスする
```

## 受け入れ基準
- [ ] `src/dashboard/sqliteHistoryPanel.ts` を削除
- [ ] `src/dashboard/historyPanel.ts` を削除
- [ ] `src/dashboard/__tests__/sqliteHistoryPanel.test.ts` を削除
- [ ] `src/dashboard/__tests__/sqliteHistoryPanel-rendering.test.ts` を削除
- [ ] `src/dashboard/__tests__/sqliteHistoryPanel-selection-ui.test.ts` を削除
- [ ] `src/dashboard/__tests__/sqliteHistoryPanel-full-render.test.ts` を削除
- [ ] `src/dashboard/__tests__/historyPanel.dom-integration.test.ts` を削除
- [ ] `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`・`historyPanel.ts`（アクティブ版）は無変更
- [ ] `npm run build` / `npm run type-check` / `npm test` が全て成功

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- Playwright等での手動 or 既存E2Eがあればダッシュボードを開き、SQLite履歴パネルの表示・検索操作を1シナリオ確認（既存のE2Eテストが `panels/asyncData` 版をカバーしていることを確認 — 新規追加は不要、既存資産の再確認のみ）

### 統合テスト
- 既存の `panels/asyncData/__tests__/` 配下のテスト（もしあれば）がそのままパスすることを確認。なければ本PBIでは新設しない（アクティブ版の挙動は変更していないため）

### 単体テスト
- 新規テストは不要（削除のみのPBIのため）。削除後に残る単体テストが全てパスすることが唯一の検証

## 実装アプローチ
- 通常のTDD（Red-Green-Refactor）は適用しない。これは削除タスクであり、「削除→ビルド/テスト実行→グリーン確認」がそのままOutside-In検証となる
- 削除は1コミットにまとめる（実装2ファイル + テスト5ファイルの同時削除）

## 見積もり
1pt（30分〜1時間、削除+検証のみ）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 削除後の `npm test` 実行結果がそのまま検証手段
- 非機能要件: なし

## 落とし穴
- `historyPanel.ts`（トップレベル）から `sqliteHistoryPanel.ts` への依存があるため、削除順序に注意（同時に削除すれば問題ないが、片方だけ消すとimportエラーになる）
- `panels/asyncData/` 配下の同名ファイルと混同しないよう、削除前に必ずパスをフルで確認する
- テストファイルの実際の格納場所は `src/dashboard/__tests__/` であり、`src/__tests__/` ではない（当初の調査メモに誤りがあったため要注意）

## Definition of Done
- [ ] 対象7ファイル（実装2 + テスト5）が削除されている
- [ ] `npm run build` / `npm run type-check` / `npm test` が全て成功
- [ ] ダッシュボードのSQLite履歴パネルを実機（Chrome）で開き、目視で表示・検索が正常動作することを確認
- [ ] コードレビュー完了
