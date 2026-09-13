# PBI 07: クレンジング reason の三重実装を単一化（none セマンティクスを正とする）

## ユーザーストーリー

クレンジング結果を見る利用者として、何もクレンジングされていないときに「Both」badge が出ず、count 詳細がロケールどおり表示されることを知りたい。なぜなら counts→reason の派生が 3 実装あり、空カウントの意味が相反（'both' vs 'none'）し、preview の詳細は英語リテラルだから。

## 優先度

- 順位: 07 / 10
- RICE スコア: 9.6（Reach=3 / Impact=1 / Confidence=80% / Effort=0.25 人週）
- 根拠: `cleansingBadge.ts:40-47`（round 4 新設 — `(0,0)`→'both'、戻り値型が 'none' を表現できない。現行呼び出し元は totalRemoved>0 ガードで安全だが、新規 caller がガードを忘れると空 badge が出る）vs `contentExtractor/cleansedReason.ts:61-75`（`resolveCleanseReason` — `(0,0)`→'none' が正しい dual）+ 同 :82-101 の map 派生 = 計 3 実装。deletion test 正: どちらか一方を消しても他が生きる。preview `previewPresenter.ts:64-70` の `Hard: n` / `Keyword: n` は英語リテラル（statusPanel は i18n キー）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 空カウントは none を返す
  Given counts が全部 0
  When reason を派生する
  Then 結果は 'none' であり badge は空文字になる

Scenario: preview の count 詳細が i18n になる
  Given クレンジング hard 3 件 / keyword 2 件
  When preview を表示する
  Then 詳細文は i18n キー由来で ja/en が切替わる
```

## 受け入れ基準

- [x] `deriveCleansedReasonFromCounts` を `resolveCleanseReason` セマンティクスへ統一（'none' 返却を許す型に）し、badge テーブルが委譲
- [x] `deriveCleansedReason`（map 派生）を単一実装へ寄せる（呼び出し元確認の上で統合 or 削除）
- [x] preview の count 詳細を badge モジュール経由 + i18n キー化（ja/en 新規キー）
- [x] systemHandlers の呼び出しは新シグネチャに整合（totalRemoved>0 ガードは冗長だが保持可）
- [x] check-i18n PASS・関連テスト green（cleansingBadge テストの `({}) → 'both'` pin を 'none' に更新）

## テスト戦略

cleansingBadge 真理値表更新 + preview/statusPanel 回帰。

## 見積もり

S（0.25 人週）。種別: refactor。

## 実装アプローチ

1. `cleansedReason.resolveCleanseReason` を正として cleansingBadge を委譲に書き換え
2. count 詳細の i18n キー新設（ja/en）
3. previewPresenter がモジュール経由の formatter を使う

## 実装メモ（2026-09-11 round 5）

- `deriveCleansedReasonFromCounts` を `resolveCleanseReason`（extractor 側の単一 dual-axis owner）に委譲。`({}) → 'none'`（round 4 の local copy は 'both' だった）。`ExtractResult['cleansedReason']` が optional 型のため `?? 'none'` で always-return 保証を文書化。
- `buildCleansingCountDetail` 新設（badge モジュールに count 詳細フォーマットを集約・i18n キー `cleansingDetailHard`/`cleansingDetailKeyword` ja/en 新設・配列 substitution — wrapper は string substitution を展開しない既知挙動のため）。
- previewPresenter の英語リテラル `Hard: n` をモジュール経由に置換。truth-value テスト更新 + sanitizePreview/mask-visualization の i18n モック更新。
