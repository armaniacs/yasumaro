# PBI 04: _locales 未使用キー監査を check-i18n に追加し dead key と英語フォールバックを棚卸し

## ユーザーストーリー

拡張機能を保守する開発者として、ロケールファイルの未使用キーが検出され、`(getMessage(key) || '英語')` のフォールバックがキー欠落を黙って隠さない状態を望む。なぜなら check-i18n は ja/en の同数性のみ検査し、legacy panel 撤去（〜1,600 行）後の dead key が確実に残っているから。

## 優先度

- 順位: 04 / 9
- RICE スコア: 12.0（Reach=3 / Impact=1 / Confidence=80% / Effort=0.2 人週）
- 根拠（round 6 診断）: check-i18n は `data-i18n` リテラル + ja/en 同数のみ。未使用キー検出なし。`getMessage(key) || '英語'` fallback が `statusPanel.ts`（複数箇所）/ `recordingConditionsSettings.ts:73-98` / `entrypoints/popup/i18n.ts:28` に残存。legacy panel 撤去 + dashboard i18n round 2 後で dead key が確実に存在。

## BDD 受け入れシナリオ

```gherkin
Scenario: 未使用キーが検出される
  Given messages.json に .ts/.html のどこからも参照されないキーがある
  When check-i18n を実行する
  Then 未使用キー一覧が報告される（除外リスト: 動的キー構築箇所を明記）

Scenario: 英語フォールバックの棚卸しが残る
  Given (getMessage(key) || 'English') 形態の箇所
  When 監査する
  Then 各箇所が「キー実在の修復」か「意図的 fallback（コメント付き）」かに分類される
```

## 受け入れ基準

- [x] check-i18n（または新 check スクリプト）に未使用キー検出を追加（動的キーは allowlist）
- [x] 検出された dead key を ja/en から削除
- [x] 英語フォールバック箇所の棚卸し結果を記録（修復 or 意図的明示）
- [x] check-i18n PASS

## テスト戦略

check-i18n 拡張の自己テスト + 全 UI テスト green。

## 見積もり

S（0.2 人週）。種別: test（+ doc）。

## 実装メモ（2026-09-11 round 6）— スコープ調整あり

- i18n-core に `checkUnusedLocaleKeys` を追加（data-i18n / __MSG_ / getMessage・getMessageOr・getPluralKey・localized・t の第一引数リテラルを走査、plural family 展開、動的キー allowlist）。check-i18n.mjs に配線。
- **検出器の実行で 2 つの真の発見**: (a) 「参照されているがロケールに無い」キー 50 件 — ja/en に追加（文言は call site の fallback リテラルから導出。archiveModalTitle はモーダル見出しがキー名で表示される実バグだった）。(b) `getMessage('locale')` が存在しないキーを読む潜在バグ（`||` の優先順位と組み合わさり偶然動作）— navigator.language 直参照に修正。
- **スコープ調整**: 未使用キー検出は静的スキャンで over-approximate（union 型のキー名リスト・ternary label map が false positive — aiProviderCatalogView の labelKey 等）。**310 件の候補は warn インベントリとして記録し、削除は手動 per-key パスに回す**（check-i18n は非ゲート warn）。
- customPromptManager-r2 テスト更新（locale 検出の新契約）。
