# PBI: ダッシュボードサイドバーにtablist/tab ARIAロールを付与

## ユーザーストーリー
スクリーンリーダー利用者として、ダッシュボードのサイドバーナビゲーションをタブパターンとして正しく認識したい、なぜなら現状はパネル要素に `role="tabpanel"` があるのにサイドバーボタン側に `role="tab"` や `aria-controls` がなく、不完全なARIAタブパターンになっているから

## ビジネス価値
- WCAG 2.1 Level AA準拠に向けたアクセシビリティ改善
- スクリーンリーダーがタブパターンを正しく認識し、ユーザーが効率的にナビゲーションできる

## 実装者向け注記（フェーズ0の既実装確認結果）

Read・grep で確認済み:
- `entrypoints/options/index.html` — サイドバーボタンは `data-panel="panel-*"` 属性を15個持つが（24〜146行目付近）、`role="tab"` や `aria-controls` は付与されていない
- パネル側（例: 161行目 `<section id="panel-general" class="panel active" role="tabpanel">`）には既に `role="tabpanel"` が付与されている
- クリックハンドラは `data-panel` 属性ベースで動作しており、role/aria追加はCSS/JSロジックに影響しない（side-effects.md M21判定で確認済み）
- 既存の類似実装パターンとして `domain-mode-tabs`（584-585行目）が `role="tablist"` + `role="tab"` + `aria-selected` を正しく実装しており、これを参考にできる

```bash
# 実装前の再確認コマンド
grep -n "data-panel=\|role=\"tabpanel\"\|role=\"tablist\"\|role=\"tab\"" entrypoints/options/index.html
grep -n "domain-mode-tab" entrypoints/options/index.html
```

## BDD受け入れシナリオ

```gherkin
Scenario: サイドバーがタブリストとして認識される
  Given ダッシュボードのサイドバーナビゲーションを表示している
  When スクリーンリーダーでサイドバーのnav要素を読み上げる
  Then "タブリスト、15個のタブ"のようにtablistパターンとして認識される

Scenario: 各サイドバーボタンが対応するパネルと関連付けられる
  Given いずれかのサイドバーボタンにフォーカスがある
  When スクリーンリーダーで読み上げる
  Then ボタンの選択状態（aria-selected）と、制御対象パネル（aria-controls）が正しく通知される

Scenario: 既存のクリック動作に回帰がない
  Given ダッシュボードを表示している
  When サイドバーボタンをクリックする
  Then 従来通り対応するパネルが表示される（data-panelベースのロジックは変更しない）
```

## 受け入れ基準
- [ ] サイドバーの `nav` 要素に `role="tablist"` を追加
- [ ] 各サイドバーボタン（15個）に `role="tab"` と `aria-controls="{対応するpanel id}"` を追加
- [ ] 各サイドバーボタンに `aria-selected` を追加し、アクティブ状態と同期させる（既存のJSロジックで `active` クラス切り替えと合わせて更新）
- [ ] 既存のクリックハンドラ（`data-panel`属性ベース）は変更しない

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- axe-core等のアクセシビリティ監査ツールでダッシュボードページのタブパターン違反が解消されることを確認

### 統合テスト
- サイドバーボタンクリック時に対応するパネルの`aria-selected`/`active`状態が正しく更新されることを検証するDOM統合テスト

### 単体テスト
- パネル切り替えロジック（既存のクリックハンドラ）が `aria-selected` の更新も含めて正しく動作することを検証

## 実装アプローチ
- **Outside-In**: 「サイドバーボタンクリック後にaria-selectedが正しく切り替わる」統合テストをRedで書き、HTML属性追加とJS更新ロジック追加でGreenにする
- `domain-mode-tabs`（584-585行目）の既存実装パターンを参考にする

## 見積もり
2pt（半日、15個のボタン全てへの属性追加とJS同期ロジックの実装含む）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: DOM属性の検証は容易
- 非機能要件: アクセシビリティ（WCAG 2.1 Level AA）

## 落とし穴
- `aria-controls` の値は各パネルの実際の `id` 属性と正確に一致させる必要がある（15箇所、タイポに注意）
- JSでパネル切り替え時に `aria-selected` を更新するロジックを追加する際、既存の `active` クラス切り替えロジックとの二重管理にならないよう、同一箇所で更新すること

## Definition of Done
- [ ] `role="tablist"`/`role="tab"`/`aria-controls`/`aria-selected` が全サイドバーボタンに付与されている
- [ ] axe-core監査でタブパターン関連の違反が解消されている
- [ ] 統合テストが追加されパスする
- [ ] 実機Chrome + スクリーンリーダー（VoiceOver等）で動作確認
- [ ] コードレビュー完了
