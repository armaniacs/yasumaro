# PBI: UI/CSS 修正 — inline style・light mode・docs/index.html・Permissions lang の修正

元指摘: Checking Team (Medium: UI Expert, Accessibility Advocate, i18n Expert, Documentation Architect)

## ユーザーストーリー
開発チームとして、4つのUI/フロントエンド改善を実施したい、(1) optionsページのインライン `style` 属性をCSSクラスに統一、(2) privacyページにライトモードフォールバックを追加、(3) docs/index.html の onclick イベントハンドラを addEventListener に変更しハードコードバージョンを動的取得に、(4) Permissions ページの lang 属性が動的ロケールに対応していることを確認、なぜならインラインスタイルは保守性を損ない、ライトモード不在はアクセシビリティ違反であり、docs/index.html のインラインイベントハンドラはキーボードユーザーにとって理想的でなく、ハードコードバージョンは更新漏れリスクがあるから

## ビジネス価値
- 保守性向上（CSS集中管理）
- アクセシビリティ改善（ライトモード対応、キーボード操作最適化）
- docs/index.html のメンテナンス負荷低減

## BDD受け入れシナリオ

```gherkin
Feature: UI/CSS 修正

  Scenario: options ページにインライン style がない
    Given entrypoints/options/index.html の手動エクスポートセクションとステータス要素に
    When インライン style 属性が存在する
    Then 全てが CSS クラスに置き換わっている

  Scenario: privacy ページがライトモードで適切に表示される
    Given OS がライトモード設定の場合
    When entrypoints/permissions/privacy.css が適用される
    Then prefers-color-scheme: light のフォールバックスタイルが存在する
    And テキスト/背景のコントラスト比が 4.5:1 以上を満たす

  Scenario: docs/index.html に onclick インラインハンドラがない
    Given 言語切り替えボタンに onclick 属性が存在する
    When addEventListener に置き換える
    Then キーボードユーザー（Enter/Space）でも言語切替が動作する

  Scenario: docs/index.html のバージョンが自動管理される
    Given <span class="badge">v6.5.41</span> がハードコードされている
    When ビルド時に package.json の version フィールドから動的に埋め込む
    Then リリースごとの手動更新が不要になる

  Scenario: Permissions ページの lang 属性が動的ロケールを反映する
    Given <html lang="en"> がハードコードされている
    When setHtmlLangAndDir() が呼ばれる
    Then ブラウザの UI ロケールに応じて lang 属性が動的に変更される
```

## 受け入れ基準
- [ ] `entrypoints/options/index.html` の全インライン `style` 属性を CSS クラスに置換
- [ ] `entrypoints/permissions/privacy.css` に `@media (prefers-color-scheme: light)` ブロックを追加
- [ ] `docs/index.html` の `onclick="setLang('ja')"` を `addEventListener` に変更
- [ ] `docs/index.html` のバージョンバッジをハードコードから動的取得に変更（GitHub Pages の制約によりリリースビルド時の埋め込み、または手動更新の運用ドキュメント化）
- [ ] Permissions ページで `setHtmlLangAndDir()` が正しく呼ばれていることを確認（既に `privacy.ts` で呼ばれていることを検証）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### E2E
- docs/index.html の言語切替動作を実機 Chrome で確認

### 単体テスト
- 該当なし（CSS と HTML の変更が中心）

## 実装アプローチ
- **並列作業**: 4項目は独立しているため並行して修正可能
- options inline style の詳細: `entrypoints/options/index.html` の manual-export-section 関連の style 属性を特定し、`entrypoints/options/styles.css` にクラス定義を追加

## 見積もり
3pt（4項目の独立修正 + docs/index.html のバージョン動的化検討）

## 技術的考慮事項
- `docs/index.html` は GitHub Pages で配信される静的なHTML。Chrome拡張のビルドプロセスに含まれていないため、`package.json` からの動的バージョン取得はビルドスクリプトの拡張が必要。代替案として `docs/` 内に `version.json` を置きJSからfetchする方式も検討
- Permissions ページの `setHtmlLangAndDir()` は既に `privacy.ts:184` で `DOMContentLoaded` 内から呼ばれている。確認のみで修正不要

## 落とし穴
- docs/index.html の翻訳システム（`TRANSLATIONS` オブジェクト）と Chrome拡張の `_locales/*/messages.json` の二重管理はこのPBIでは解決せず、方針の文書化にとどめる（PBI-F で別途対応する場合はこのPBIから削除する）
- バージョン動的化の方法によっては CDN キャッシュの影響を受ける。実装方針はレビューで確認すること

## Definition of Done
- [ ] options ページのインラインスタイルが CSS クラスに置換されている
- [ ] privacy ページにライトモードスタイルが追加されている
- [ ] docs/index.html の onclick が addEventListener に変更されている
- [ ] バージョンバッジの運用方針が決定・実装されている
- [ ] Permissions ページの lang 属性が動的ロケール対応済みであることを確認
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
