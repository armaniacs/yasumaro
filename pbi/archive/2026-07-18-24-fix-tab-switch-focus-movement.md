# PBI: 設定画面タブ切り替え後のフォーカス移動を追加

## ユーザーストーリー
キーボード操作ユーザーとして、タブパネルを切り替えた後にフォーカスが新しいパネル内の操作可能要素に移動してほしい、なぜなら現状はタブボタンにフォーカスが残ったままで、WCAG 2.4.3 (Focus Order) の観点から問題があるから

## ビジネス価値
- WCAG 2.4.3準拠によるアクセシビリティ改善
- キーボードユーザーがタブ切り替え後すぐにパネル内容を操作できるようになる

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/popup/popup.ts:37-75`（`initTabNavigation`）— タブボタンクリック時に `active` クラス・`aria-selected`・`aria-hidden`・`inert` 属性の切り替えは実装済みだが、フォーカス移動処理はない
- 対処案（親レポートより）: パネル切替後に以下を追加
  ```ts
  activePanel.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus()
  ```
- 既存の属性操作ロジック（`inert`/`aria-hidden`）とは独立した追加処理であり、既存ロジックへの影響は薄い（side-effects.md M24判定で確認済み）

```bash
# 実装前の再確認コマンド
sed -n '37,75p' src/popup/popup.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: タブ切り替え後に新パネル内の最初の操作可能要素にフォーカスが移動する
  Given popup UIで現在「一般設定」タブがアクティブな状態
  When キーボードまたはマウスで「プライバシー設定」タブに切り替える
  Then フォーカスは「プライバシー設定」パネル内の最初の操作可能要素（button, input等）に移動する

Scenario: パネル内に操作可能要素がない場合はフォーカス移動が発生しない
  Given 操作可能要素を含まないパネルが存在する場合
  When そのタブに切り替える
  Then querySelectorがnullを返しfocus()は呼ばれない（エラーにならない）
```

## 受け入れ基準
- [ ] `initTabNavigation`（`src/popup/popup.ts:37-75`）のタブ切り替え処理に、新しいアクティブパネル内の最初の操作可能要素へのフォーカス移動を追加
- [ ] 対象セレクタ: `button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])`
- [ ] 既存の `inert`/`aria-hidden`/`active` クラス切り替えロジックは変更しない

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- Playwrightでタブ切り替え操作を行い、`document.activeElement` が新パネル内の要素になっていることを確認

### 統合テスト
- `initTabNavigation` のクリックイベントハンドラに対して、タブ切り替え後に `document.activeElement` が期待通りの要素になることをjsdom環境で検証

### 単体テスト
- フォーカス対象要素を取得するセレクタロジックを関数として切り出せる場合、様々なパネル構造（操作可能要素あり/なし、複数あり）でのケースを検証

## 実装アプローチ
- **Outside-In**: 「タブ切り替え後にフォーカスが新パネル内要素に移動する」統合テストをRedで書き、`initTabNavigation`にフォーカス移動処理を追加してGreenにする

## 見積もり
1pt（1〜2時間）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: jsdom環境で `document.activeElement` の検証が容易
- 非機能要件: アクセシビリティ（WCAG 2.4.3 Focus Order）

## 落とし穴
- フォーカス移動によりスクリーンリーダーが唐突にパネル内容を読み上げ始める可能性があるため、パネル自体（`role="tabpanel"` 要素）にフォーカスを移動する設計も代替案として検討の余地がある。親レポートの対処案（最初の操作可能要素へのフォーカス）を基本としつつ、実装時にUXの検証を行うこと

## Definition of Done
- [ ] タブ切り替え後のフォーカス移動が実装されている
- [ ] 統合テストが追加されパスする
- [ ] 実機Chrome + キーボード操作で動作確認
- [ ] コードレビュー完了
