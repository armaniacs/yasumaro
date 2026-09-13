# PBI 05: クレンジング badge 表示政策を CleansingBadge モジュールに統合

## ユーザーストーリー

クレンジング結果を確認する利用者として、badge 表示の文言・理由分類が popup のどの画面でも一貫してほしい。なぜなら現状 `hard / keyword / both` の変換が 4 箇所に別実装で、文言や reason 追加時に 4 箇所同時修正が必要だから。

## 優先度

- 順位: 05 / 9
- RICE スコア: 21.3（Reach=4 / Impact=1 / Confidence=80% / Effort=0.15 人週）
- 根拠（2026-09-11 診断）:
  - `src/popup/statusPanel.ts:86-101` `getCleansedReasonText()` — hard/keyword/both switch
  - `src/popup/statusPanel.ts:103-129` `updateCleansingStatus()` — 同一 counts→表示変換の第 3 の実装
  - `src/popup/previewPresenter.ts:47-81` `updateCleansingInfo()` — 同一 switch + `Badge (Hard: N, Keyword: M)` 接尾
  - `src/background/handlers/systemHandlers.ts:157-167` — counts から hard/keyword/both 派生（第 4）
  - deletion test: 各実装を単独で削除しても他が壊れない = 浅いクラスタ。政策テーブル 1 箇所に集約すれば複雑さが正の方向に集まる

## BDD 受け入れシナリオ

```gherkin
Scenario: reason 'both' の badge が全画面で同一文言になる
  Given クレンジング理由が both
  When  popup badge / preview の cleansing info を表示する
  Then  両者は CleansingBadge モジュールの同一テーブルから生成された文言になる

Scenario: background handler の理由派生も同一テーブルを使う
  Given counts {hardStripRemoved: 3, keywordStripRemoved: 0}
  When  CONTENT_CLEANSING_EXECUTED を組み立てる
  Then  理由は 'hard' と判定される（テーブルと同一ロジック）
```

## 受け入れ基準

- [x] `CleansingBadge` モジュール（popup 側: `reason → {badgeText, detailText}`、`getMessage` 注入で chrome-free）を新設
- [x] statusPanel 2 実装・previewPresenter・systemHandlers の理由派生が 1 テーブル参照に置き換わる
- [x] i18n キー・表示文言は変えない（振る舞い不変）
- [x] 新規単体テスト（reason→文言の真理値表 + counts→reason 派生）green
- [x] popup / background 関連テスト green

## テスト戦略

- 単体: CleansingBadge 真理値表（hard/keyword/both × counts 組み合わせ）
- 回帰: 既存 statusPanel / previewPresenter テスト無修正 green

## 見積もり

S（0.15 人週）。種別: refactor。

## 実装アプローチ

1. `src/popup/cleansingBadge.ts`（または utils 配下が適切なら移動）に政策テーブル + 純関数を新設
2. 4 消費者を置換（background handler は popup import を避けるため、counts→reason 派生の純関数のみ共有。配置は診断時に決定 — utils（中立）推奨）
3. テスト

## 実装メモ（2026-09-11）

- `src/utils/cleansingBadge.ts`（Layer 0・getMessage 注入で chrome-free）新設: `getCleansedBadgeText`（reason→badge 文言テーブル、unknown 値は旧 default 分岐どおり空文字）+ `deriveCleansedReasonFromCounts`（counts→hard/keyword/both 派生、旧 systemHandlers セマンティクス維持）。
- statusPanel（2 実装）/ previewPresenter / systemHandlers を 1 テーブル参照に置換。background→popup 依存を作らないため utils 配置。
-真理値表テスト `cleansingBadge.test.ts` 新設。
