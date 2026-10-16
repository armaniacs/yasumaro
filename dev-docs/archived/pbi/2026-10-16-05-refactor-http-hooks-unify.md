# PBI: HTTPプロバイダHookの1組化（要約/テスト二重の解消）

## ユーザーストーリー
AIプロバイダ追加の実装者として、同じ癖を2組のclosureで書きたくない。なぜなら文面変更が2箇所に割れてdriftするから。

## 優先度
- 順位: 05 / 12
- RICEスコア: 21（Reach=30 / Impact=1.5 / Confidence=0.7 / Effort=1.5）
- 根拠: 依存あり（PBI 03の生成seam統一後に着手）。A1・D2と並列可。

## 背景
arch診断B1。`HttpSummaryHooks`/`HttpTestHooks`で資格・構築・parseを2度書く。`checkCredentials`の戻り型違いが典型。

## BDD受け入れシナリオ
Scenario: 1組の癖で両フローが動く
  Given 新Hook実装1組
  When 要約と接続テストを呼ぶ
  Then 両方が正しく動く

Scenario: 文面変更が1箇所で済む
  Given 資格文面の変更
  When 修正する
  Then 要約・テスト両方のテストが緑のまま変わる

## 受け入れ基準
- [x] Hookが1組に統一され2組の重複が消える
- [x] 既存provider（Gemini/OpenAI互換/内蔵）が新Hookに移行する
- [x] `npx vitest run src/background/ai/` 全緑

## テスト戦略
- 単体: Hook表テスト（Red→Green）
- 既存: ai系テストで回帰確認

## 見積もり
3.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
