# PBI-21: Markdown 1クリックコピー

## ユーザーストーリー

Obsidian を使っていないユーザーとして、記録した要約を Notion やメモアプリに簡単に貼り付けたい。なぜなら、Yasumaro は Obsidian 以外のツールとも連携できることを知りたいから。

## ビジネス価値

- Obsidian ユーザー以外へのターゲット拡大に直結する
- 他ノートアプリユーザーにも Yasumaro の価値を提供できる
- Markdown コピー回数を指標として測定できる

## BDD 受け入れシナリオ

```gherkin
Scenario: ポップアップで Markdown をコピーする
  Given ユーザーが手動または自動でページを記録した
  And ポップアップに記録完了画面が表示されている
  When 「Markdown をコピー」ボタンを押す
  Then クリップボードに Markdown 形式のテキストがコピーされる
  And コピー成功のトーストが表示される

Scenario: ダッシュボードで履歴から Markdown をコピーする
  Given ユーザーがダッシュボードの SQLite History を開いている
  And 閲覧履歴が1件以上存在する
  When 任意の履歴行の「コピー」ボタンを押す
  Then クリップボードに該当エントリの Markdown がコピーされる

Scenario: コピー内容に必要な情報が含まれる
  Given ユーザーが Markdown コピーを実行した
  When クリップボードの内容を確認する
  Then タイトル、URL、要約、タグ、保存日時が含まれている
```

## 受け入れ基準

- [ ] ポップアップの記録完了画面に「Markdown をコピー」ボタンを追加する
- [ ] ダッシュボードの SQLite History 各行に「コピー」アクションを追加する
- [ ] クリップボードにコピーする形式：タイトル / URL / 要約 / タグ / 保存日時を含む Markdown
- [ ] コピー成功時にトーストを表示する
- [ ] 形式は将来的なカスタマイズを見据え、テンプレート関数として分離する
- [ ] i18n（ja/en）対応

## テスト戦略（t_wada スタイル）

### E2E テスト
- ポップアップからの Markdown コピー → 外部エディタへの貼り付け

### 統合テスト
- SQLite History 行からのコピーアクション
- クリップボード書き込みの成否ハンドリング

### 単体テスト
- Markdown テンプレート関数の入出力
- タグ・改行・特殊文字のエスケープ
- 空データのハンドリング

## 実装アプローチ

- **Outside-In**: 統合テストでポップアップとダッシュボード両方のコピー動作を定義
- 既存の `formatEntriesToMarkdown` を汎用化し、Obsidian 向けと汎用 Markdown 向けの両方に対応
- クリップボード操作は `navigator.clipboard.writeText` を使用

## 見積もり

**3 ストーリーポイント**

- `formatEntriesToMarkdown` 汎用化: 1 SP
- ポップアップ UI 追加: 1 SP
- ダッシュボード UI 追加・テスト: 1 SP

## 技術的考慮事項

- 依存関係: `formatEntriesToMarkdown`, SQLite History パネル, ポップアップの記録完了画面
- テスタビリティ: `navigator.clipboard` を vitest/jsdom でモック
- 非機能要件: クリップボード書き込みはユーザージェスチャー発生時に実行（ポップアップ内では通常問題なし）

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "formatEntriesToMarkdown" src/
grep -rn "copy" src/dashboard/ | head -20
```

`formatEntriesToMarkdown` は `src/dashboard/obsidianFormatter.ts` に存在。Obsidian 向けの Markdown 出力だが、構造を汎用化できる。

### 実装手順

1. `src/dashboard/markdownFormatter.ts` を新規作成（汎用 Markdown テンプレート関数）
2. `src/dashboard/obsidianFormatter.ts` は既存のまま、またはラッパーとして移行
3. ポップアップの記録完了画面にコピーボタンを追加
4. `src/dashboard/sqliteHistoryPanel.ts` に各行のコピーアクションを追加
5. クリップボード書き込みユーティリティを共通化

### 落とし穴

- Obsidian 向け Markdown と汎用 Markdown の区別を明確にする
- タグの表記法（#tag vs - tag）でノートアプリによって見栄えが変わる
- 大きな要約テキストのコピー時のパフォーマンス

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] ポップアップとダッシュボードの両方でコピーが動作する
- [ ] i18n キーが ja/en に追加されている
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
