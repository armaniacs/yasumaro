# PBI: 保存時のタグ自動クラスタリング / 正規化

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: A. 知識活用・検索強化
- type: feat / 優先度: 中

## ユーザーストーリー

Yasumaro 利用者として、AI が抽出したタグの表記ゆれを自動で統合してほしい。なぜなら、"AI" と "人工知能" が別タグになると検索や集計が分散し、タグの価値が下がるから。

## ビジネス価値

タグの一貫性が上がり、検索・グラフ表示・フィルタの精度が向上する。測定: 統合により削減された重複タグ数。

## BDD受け入れシナリオ

```gherkin
Scenario: 表記ゆれタグが正規化されて保存される
  Given "AI" と "人工知能" を同義とする正規化辞書が設定されている
  When  ページが記録されタグ "人工知能" が抽出される
  Then  保存時にタグが "AI" に正規化される

Scenario: 辞書にないタグはそのまま保存される
  Given 正規化辞書に該当エントリがない
  When  未知のタグが抽出される
  Then  タグは変更されずそのまま保存される

Scenario: SQLite履歴ページでも正規化後タグが表示される
  Given SQLiteに保存されたレコードにタグ "AI" が含まれている
  When  ダッシュボードの「履歴」ページ（SQLite版）を開く
  Then  各エントリにタグバッジが表示される
  And   タグバッジをクリックするとそのタグでフィルタされる
```

## 受け入れ基準

- [ ] 正規化辞書を設定・編集できる
- [ ] 保存時にタグへ正規化を適用する
- [ ] 辞書未該当タグは非破壊で保存する
- [ ] SQLite版履歴ページ（`sqliteHistoryPanel.ts`）の各エントリにタグバッジを表示する
- [ ] SQLite版履歴ページでタグバッジクリックによるタグフィルタが機能する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 辞書設定 → ページ記録 → 正規化後タグで保存を確認

### 統合テスト
- 抽出タグ → 正規化 → SQLite 保存の連携

### 単体テスト
- 正規化辞書のマッチング（完全一致 / 大文字小文字 / 全角半角）
- 未該当タグの非破壊

## 実装アプローチ

Outside-In / Red-Green-Refactor。正規化ロジックは純粋関数として単体テスト厚めに。

## 見積もり

3pt（要チーム見積もり）

## 技術的考慮事項

- 依存: なし
- 再利用: `src/dashboard/historyTagEditModal.ts`、`src/background/privacyPipeline.ts`（タグ抽出段）、`src/offscreen/schema.ts`（tags列は既存）
- 現状ギャップ: `src/dashboard/sqliteHistoryPanel.ts` / `dashboardSqliteService.ts`（`BrowsingLogEntry.tags`は型定義済みだが未使用）はタグバッジ未実装。旧来の`src/dashboard/historyPanel.ts` + `historyEntryRow.ts`（`makeTagBadges`関数）にはタグバッジ・フィルタ機能が既にあるため、同等のUIをSQLite版にも移植する

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "normalize\|正規化\|tagAlias\|synonym" src/
grep -rn "tags" src/background/privacyPipeline.ts
grep -n "tags" src/dashboard/sqliteHistoryPanel.ts src/dashboard/dashboardSqliteService.ts
```

### 落とし穴

- 全角/半角・大文字小文字・トリムをどこまで正規化対象にするか、辞書適用前の前処理を明確に定義する。
- SQLite版履歴ページへのタグ表示追加は、`historyEntryRow.ts`の`makeTagBadges`をそのまま流用せず、`sqliteHistoryPanel.ts`側のレンダリング構造（`BrowsingLogEntry`型・DOM生成箇所）に合わせて実装すること。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
