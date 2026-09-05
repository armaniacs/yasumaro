# PBI: popup ステータス表示を色のみからテキストラベル付きに変更

## ユーザーストーリー
拡張機能の利用者として、記録可否・プライバシー状態が色だけでなく文字でも分かってほしい、なぜなら色覚の違いや画面の見え方によっては緑・赤・黄の丸アイコンだけでは状態を判別できず、記録漏れや誤記録に気づけないから

## 優先度
- 順位: 15 / 26
- RICEスコア: 800（Reach=500 / Impact=1 / Confidence=0.8 / Effort=0.5日）
- 根拠: 色のみの状態伝達はアクセシビリティ（WCAG 1.4.1 色に依存しない）の違反に当たり、影響範囲はpopup利用者全体。修正は表示層の追加のみで効果が確実。

## BDD受け入れシナリオ
```gherkin
Scenario: ドメイン状態アイコンにテキストラベルが伴う
  Given 記録可能ページとブロック対象ページをそれぞれ開いた状態
  When  popupのステータスサマリーを見る
  Then  アイコンの隣に「記録可能」「ブロック中」等のテキストラベルが表示される

Scenario: プライバシー状態が色覚に依存せず判別できる
  Given プライベート検出ページと通常ページをそれぞれ開いた状態
  When  popupのプライバシーアイコンを見る
  Then  色に加えてテキスト（例: プライベート検出・公開ページ・情報なし）が表示される

Scenario: スクリーンリーダーで状態が読み上げられる
  Given popupを開いた状態
  When  スクリーンリーダーでステータスアイコンにフォーカスする
  Then  aria-label（statusRecordable / statusBlocked / statusPrivateDetected 等）が読み上げられる
```

## 受け入れ基準
- [ ] `statusDomainIcon`・`statusPrivacyIcon` の隣に可視テキストラベルが表示される（色のみの伝達を解消）
- [ ] 既存の `aria-label`（記録可能・ブロック中・プライベート検出等）が維持され、スクリーンリーダーで判別できる
- [ ] 日英両ロケールでラベル文字列が `getMessage` 経由で解決される（ハードコードなし）
- [ ] popup関連の既存テストがパスする（必要に応じて期待値を更新）

## テスト戦略
- 単体: `statusPanel.test.ts` 系にラベルテキスト存在のアサーションを追加（allowed/blocked・private/public/no-info の各分岐）
- E2E/目視: popupを開き、記録可能・ブロック・プライベート検出の各状態でアイコン＋テキストが併記されることを確認

## 実装アプローチ
`renderStatusPanel` のアイコン描画箇所に、既存の `aria-label` と同じメッセージキーを可視テキストとして併記する。SVG自体（`updateStatusIcon` の形状描画）は変えず、アイコン要素の隣に `.status-label` 等のテキスト要素を追加し、CSSで色クラスと連動させる。

## 見積もり
2ポイント（0.5日相当：表示2箇所のラベル追加＋i18n確認＋テスト更新が中心）

## 実装者向け注記
- 確認済み現状: `src/popup/statusPanel.ts:201-231` の `renderStatusPanel` が `statusDomainIcon` / `statusPrivacyIcon` の状態を `className = 'status-icon status-success|error|warning|muted'` と `updateStatusIcon(domUtils.ts:15)` のSVG形状のみで表現している。可視テキストは詳細欄（`statusDomainState:233-246`）にのみあり、サマリーアイコン自体に文字ラベルがない
- 形状はあるが色連動: `rg -n "updateStatusIcon|status-svg" src/popup/domUtils.ts src/popup/statusPanel.ts` — SVGのチェック/バツ/感嘆符は描かれるが、凡例なしでは意味が伝わらない
- aria-labelは既存: `rg -n "aria-label" src/popup/statusPanel.ts` — `statusRecordable / statusBlocked / statusPrivateDetected / statusPublicPage / statusNoInfo` が設定済み。可視ラベルには同じキーを使うこと
- テスト期待値: `rg -n "status-success|status-warning|status-muted" src/popup/__tests__/statusPanel.test.ts src/popup/__tests__/main.test.ts` — classNameアサーションが中心のため、ラベル追加で壊れる箇所は少ない見込み
- スコープ補正なし。本PBIはサマリーアイコン2箇所のみとし、詳細欄の文言変更は含めない

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（ACCESSIBILITY.md の該当箇所があれば）
