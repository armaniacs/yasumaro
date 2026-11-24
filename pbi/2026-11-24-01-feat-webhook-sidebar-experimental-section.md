# PBI: webhook export をサイドバーの「開発中」区分へ移す

## ユーザーストーリー
設定画面を使う利用者として、webhook export が「開発中」の機能だと一目で分かるようにしたい、なぜなら安定機能と同じ「設定」区分に並んでいると、完成した機能だと誤解して記録の転送先に使ってしまうから。

## ビジネス価値
- 開発中の機能が、安定機能と区別して提示される
- 保存済みコレクション、Ask 履歴、リサーチレポートと同じ扱いになり、サイドバーの分類基準が揃う
- 測定方法: webhook export のタブが「開発中」区分の見出しの下に表示され、「設定」区分には表示されないこと

## BDD受け入れシナリオ

```gherkin
Scenario: webhook export が「開発中」区分に表示される
  Given 利用者が設定画面を開いている
  When  サイドバーを表示する
  Then  「Webhook Export」のタブは「In Development」の見出しの下に並ぶ
  And   「Settings」の見出しの下には表示されない

Scenario: 移動後も webhook export の設定画面が開ける
  Given サイドバーの「In Development」区分に「Webhook Export」が表示されている
  When  利用者がそのタブを選ぶ
  Then  webhook export の設定パネルが表示される
  And   保存済みの設定値は移動前と変わらない
```

## 受け入れ基準
- [ ] `panel-webhook-export` の分類が `experimental` になっている
- [ ] 設定画面の HTML で、タブが「開発中」区分の見出しの下にある
- [ ] パネルカタログと HTML の区分が一致している(既存の整合テストが緑)
- [ ] 設定値、保存処理、送信処理に変更がない

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加しない(区分の移動だけで、操作の流れは変わらない)

### 統合テスト
- パネルカタログと設定画面の HTML を突き合わせる既存テストで、`panel-webhook-export` が `experimental` として一致すること

### 単体テスト
- `panelCatalog.test.ts` の期待値で、`panel-webhook-export` を `settings` の一覧から `experimental` の一覧へ移す
- `experimental` 区分の並び順が、カタログと HTML で同じであること

## 実装アプローチ
- **Outside-In**: 先に `panelCatalog.test.ts` の期待値を書き換えて失敗を確認し、カタログと HTML を直して緑にする
- **Red-Green-Refactor**: 区分の移動だけなので、リファクタリングは不要

## 見積もり
1 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: DOM を組み立てず、カタログの定数と HTML の文字列で検証できる
- 非機能要件: ラベル文言(`webhookExportTab`)と i18n キーは変更しない。アクセシビリティ上、`role="tab"` と `aria-controls` は維持する

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。「開発中」区分は既に存在し、新規実装は不要。

```bash
rtk grep -n "experimental" /Users/yaar/Playground/yasumaro/src/dashboard/panels/panelCatalog.ts
rtk grep -n "experimentalSection" /Users/yaar/Playground/yasumaro/entrypoints/options/index.html
```

- 区分の型: `src/dashboard/panels/panelCatalog.ts` の `SidebarSection`(`'experimental'` あり)
- 現在の webhook の定義: 同ファイルの `panel-webhook-export`(`sidebarSection: 'settings'`)
- 現在の「開発中」の所属: 保存済みコレクション、Ask 履歴、リサーチレポート

### 範囲
- 含める: サイドバーの区分の移動のみ
- 含めない: 設定画面内の「実験的」ラベルの追加、機能の無効化、送信処理の変更

### 実装手順
1. `src/dashboard/panels/__tests__/panelCatalog.test.ts` の期待値を、`panel-webhook-export` が `experimental` に属する形へ書き換え、失敗を確認する
2. `panelCatalog.ts` で `panel-webhook-export` の `sidebarSection` を `'experimental'` に変える。他の `experimental` の項目と並びを揃え、設定区分にあった位置のコメントも実態に合わせる
3. `entrypoints/options/index.html` で、`panel-webhook-export` のタブのボタンを「In Development」区分の見出しの下へ移す
4. `npm run validate` で全体を確認する

### 落とし穴
- カタログと HTML の両方に区分の定義がある。片方だけ直すと、整合テストが赤になるか、表示と内部の分類がずれる
- 他の `experimental` の項目は `tabParam` を持つ。webhook に URL の `tabParam` が必要かは、既存のディープリンクの有無を確認してから決める。既存の導線を壊さないこと
- 設定区分から外れたあと、設定画面の他の箇所(検索、ディープリンク、`deepLinkSections`)が webhook を設定区分の項目として参照していないか確認する
- `data-i18n` のキーと en/ja の messages.json は変えない

## Definition of Done
- [ ] 全 BDD シナリオが、テストまたは整合テストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(サイドバーの区分を記載した docs があれば追従)
