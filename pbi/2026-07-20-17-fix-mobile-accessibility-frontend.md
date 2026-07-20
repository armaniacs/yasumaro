# PBI: Popup/Dashboard のモバイル対応と ARIA 改善

元指摘: Checking Team (High: Edge & Mobile Strategist; Medium: Accessibility Advocate)

## 実装状況（調査日: 2026-07-20、状態: ⬜ 未着手）

## ユーザーストーリー

開発チームとして、Popup と Dashboard の HTML に viewport meta を追加し、レスポンシブ CSS を整備し、Dashboard サイドバーの見出し構造と tablist のキーボード操作性を改善したい。なぜなら、Android Chrome では popup が崩れ、スクリーンリーダー利用者はサイドバーのセクション区切りを見出しとして認識できず、tablist を矢印キーで移動できないから。

## ビジネス価値

- モバイルユーザー体験向上
- WCAG 2.1 AA 準拠の一歩
- Chrome サイドパネル可変幅への対応

## 前提・制約

- `entrypoints/popup/index.html` に viewport meta が欠落
- `entrypoints/options/index.html` も viewport meta が欠落（models-dev-dialog.html や permissions/index.html には存在）
- サイドバー区切りは `class="sidebar-section-label"` の `<div>` (`options/index.html:23,107,137`)
- tablist は 14個の `role="tab"` ボタンで構成
- `prefers-color-scheme` / `prefers-reduced-motion` は既に対応済み

## BDD受け入れシナリオ

```gherkin
Feature: Mobile and accessibility frontend improvements

  Scenario: Popup has viewport meta tag
    Given popup HTML is loaded
    Then `<meta name="viewport" content="width=device-width, initial-scale=1.0">` exists

  Scenario: Dashboard is responsive on narrow widths
    Given the side panel width is 320px
    Then form elements stack vertically
    And text does not overflow

  Scenario: Sidebar sections are headings
    Given a screen reader user navigates the dashboard
    Then "Settings", "Data", "Tools" sections are announced as headings

  Scenario: Tablist supports roving tabindex
    Given keyboard focus is on a tab
    When the user presses Left/Right arrow keys
    Then focus moves to the adjacent tab
    And only the active tab is in the tab order
```

## 受け入れ基準

- [ ] 全 extension HTML エントリポイント（popup, options/dashboard, permissions, wizard 等）に viewport meta タグを追加
- [ ] `entrypoints/popup/styles.css` と `entrypoints/options/dashboard.css` に `@media (max-width: 480px)` 等のレスポンシブスタイルを追加
- [ ] Dashboard サイドバーのセクション区切りを `<h2>` または `<div role="heading" aria-level="2">` に変更
- [ ] サイドバー tablist に roving tabindex を実装（active タブのみ `tabindex="0"`、他は `"-1"`、左右矢印キーで移動）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `extractor.test.ts` 等既存テストへの影響確認
- 新規 a11y テスト（roving tabindex）

### 統合テスト / E2E
- Playwright でモバイル viewport 時のレイアウト確認
- axe DevTools で見出し・tablist 違反の解消確認

## 実装アプローチ

- **Outside-In**: HTML meta → CSS media queries → JS roving tabindex
- `focusTrap.ts` や既存のキーボードハンドラを参考に tablist 制御を追加

## 見積もり
2pt（viewport + CSS + 見出し + roving tabindex + テスト）

## 副作用
🟢 なし — UI の見た目・操作性改善のみ。

## 落とし穴
- roving tabindex の実装は、既存の `focusTrap.ts` と競合しないよう注意
- CSS Grid/Flexbox の変更が既存のダークモードトークンと干渉しないか確認

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
