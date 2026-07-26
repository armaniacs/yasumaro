# PBI: popupの設定UIをダッシュボードに一本化する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（UI変更のためユーザーの操作導線が変わる。既存ユーザーの混乱を避けるための移行期間・案内表示を検討する）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の UI Expert からの指摘。`entrypoints/popup/index.html` と `entrypoints/options/index.html` で設定UIが重複している。ユーザーがどちらを使うべきか混乱し、両方操作すると互いに上書きする可能性がある。提案は「ポップアップのGeneralタブを廃止し、ダッシュボードに統一誘導する」こと。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "data-panel\|settings" entrypoints/popup/index.html | head -20
grep -n "data-panel" entrypoints/options/index.html | head -20
```

popup側でどの設定項目が重複しているか（General タブの範囲）を特定し、popup固有の機能（記録ボタン、ステータス表示等）と設定機能を明確に区別する。「#menuBtn がダッシュボードを新規タブで開く」という既存の導線（メモリに記録あり）を活用できるか確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: popupのGeneral設定タブがダッシュボードへの誘導に置き換わる
  Given popup UIに設定関連のGeneralタブがある
  When ユーザーがこのタブを開こうとする
  Then 設定項目の代わりに「詳細設定はダッシュボードで」という案内とダッシュボードへのリンクが表示される

Scenario: ダッシュボードで全ての設定が引き続き利用可能である
  Given popupから設定機能が削除された
  When ユーザーがダッシュボードを開く
  Then 従来popupにあった設定項目が全てダッシュボードで設定可能である（機能欠落がない）

Scenario: popup固有の機能は維持される
  Given popup UIの記録ボタン・ステータス表示等
  When 設定UI統一後のpopupを確認する
  Then これらの機能は変更されず引き続き動作する
```

## 受け入れ基準
- [ ] popup側の設定関連UI（Generalタブ等）とpopup固有機能（記録・ステータス表示）を明確に切り分ける
- [ ] 設定関連UIを、ダッシュボードへの誘導リンク（既存の`#menuBtn`の仕組みを活用）に置き換える
- [ ] ダッシュボード側に、popupから削除される設定項目が全て存在することを確認する（機能欠落がないことを確認）
- [ ] 既存の popup/dashboard 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 統合テスト（手動）
- 実ブラウザでpopupを開き、設定関連UIがダッシュボード誘導に置き換わっていることを確認
- ダッシュボードで全設定項目が利用可能であることを確認

### 単体テスト
- 既存のpopup関連テストが、設定UI削除後も回帰しないことを確認（設定UI依存のテストは更新が必要）

## 実装アプローチ

1. popup側の設定関連UI要素を特定
2. ダッシュボードに同等の設定項目が存在することを確認（不足があれば先に追加）
3. popup側の設定UIをダッシュボードへの誘導リンクに置き換える
4. 既存テストを更新し回帰確認

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `entrypoints/popup/index.html`, `entrypoints/options/index.html`
- テスタビリティ: 既存のpopup/dashboardテストが土台
- 非機能要件: UX（操作導線の一貫性）

## Definition of Done
- [ ] popup側の設定UIがダッシュボード誘導に置き換わっている
- [ ] ダッシュボードで機能欠落がないことが確認されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（UI Expert指摘）
- 対象コード: `entrypoints/popup/index.html`, `entrypoints/options/index.html`
