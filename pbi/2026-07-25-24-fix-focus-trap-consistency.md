# PBI: フォーカストラップとキーボードナビゲーションをpopup/dashboardで統一する

**作成日**: 2026-07-25
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（既存のフォーカス制御の挙動が変わる可能性があり、アクセシビリティ回帰テストが必要）

---

## 背景

Checking Team レビュー（2026-07-25）の Accessibility Advocate からの指摘。タブパネル切り替え時にフォーカスを最初のフォーカス可能要素に移動しているが、`src/popup/utils/focusTrap.ts` の共通実装と、`popup`/`dashboard` それぞれで直接フォーカス操作を行っている箇所が矛盾する可能性がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "focus()\|focusTrap\|trapFocus" src/popup/main.ts src/popup/navigation.ts
grep -rn "focus()\|focusTrap\|trapFocus" src/dashboard/*.ts
cat src/popup/utils/focusTrap.ts
```

`popup/navigation.ts`（タブ管理）と `dashboard/` 双方でのフォーカス制御実装を突き合わせ、実際にどこが `focusTrap.ts` を経由せず直接 `.focus()` を呼んでいるかを特定する。

## 受け入れ基準（BDD）

```gherkin
Scenario: popupのタブ切り替え時にfocusTrapを経由してフォーカスが移動する
  Given popup UIで複数のタブパネルが存在する
  When ユーザーがタブを切り替える
  Then focusTrap.ts の共通ロジック経由で最初のフォーカス可能要素にフォーカスが移動する

Scenario: dashboardのパネル切り替え時も同じロジックを使う
  Given dashboard UIでパネル（data-panel）を切り替える
  When ユーザーが別のパネルに切り替える
  Then popup と同じ focusTrap ロジックが適用される

Scenario: キーボードのみでの操作でフォーカスが失われない
  Given キーボードのみでpopup/dashboardを操作するユーザー
  When Tabキーでフォーカス可能要素を巡回する
  Then フォーカスがトラップ範囲外に漏れない
```

## 受け入れ基準
- [ ] `popup/main.ts`, `popup/navigation.ts`, `dashboard/` 内で直接 `.focus()` を呼んでいる箇所を洗い出す
- [ ] それらを `focusTrap.ts` の共通関数経由に統一する（dashboard用に共通化が必要な場合は関数を汎用化する）
- [ ] 既存のアクセシビリティ関連テストが全てパスする
- [ ] 手動でのキーボードナビゲーション確認（Tab/Shift+Tab）を行う

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `focusTrap.ts` の共通関数がpopup/dashboard双方から同じ挙動で呼び出せることを確認

### 統合テスト（手動）
- 実ブラウザでpopup/dashboardのタブ・パネル切り替え時のフォーカス移動を確認（Lighthouse/axe DevToolsも活用）

## 実装アプローチ

1. `focusTrap.ts` の現在のAPIを確認し、dashboard側でも再利用可能な形に汎用化する
2. `dashboard/` 内の直接フォーカス操作箇所を `focusTrap.ts` 経由に置き換える
3. 手動テストでキーボードナビゲーションを確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/popup/utils/focusTrap.ts`
- 非機能要件: WCAG 2.1 Level AA準拠（[docs/ACCESSIBILITY.md](../docs/ACCESSIBILITY.md)参照）

## Definition of Done
- [ ] popup/dashboard双方でfocusTrap.tsが統一的に使われている
- [ ] 既存テストが全てパスする
- [ ] 手動キーボードナビゲーション確認が完了している
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Accessibility Advocate指摘）
- 対象コード: `src/popup/main.ts`, `src/popup/utils/focusTrap.ts`, `src/dashboard/`
