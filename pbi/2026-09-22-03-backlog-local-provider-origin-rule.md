# PBI: ローカルプロバイダ向け Origin-strip の汎用化

## ユーザーストーリー
LM Studio などのローカル AI プロバイダを使う利用者として、Ollama と同じ CORS 対策が効くようにしたい、なぜなら Origin ヘッダが原因でリクエストが拒否される場合があるから。

## 優先度
- 順位: 03 / 3
- RICEスコア: 1.0（Reach=2 / Impact=1 / Confidence=0.5 / Effort=1）
- 根拠: LM Studio に Origin 対策が必要かどうかが未確認で、効果が最も不確か。先に investigate で必要性を確定させるのが前提。
- 再検討トリガー: 2つ目のローカルプロバイダで CORS 対策が必要になった時（LM Studio の拒否報告など）。それまでは着手しない。

## 背景（2026-09-22 時点の現状）
- Origin-strip は Ollama 専用で、`src/background/net/ollamaOriginRule.ts`（66行）と `ollamaSettingsObserver.ts`（31行）が担う。
- 呼び出しは `src/background/service-worker.ts:15-16` と `src/background/handlers/lifecycleHandlers.ts:20`。既定 URL は `lifecycleHandlers.ts:23` で registry から引く。
- `src/utils/ssrfGuard.ts:207` の `ALLOWED_LOCALHOST_PORTS` は 27123, 27124, 11434, 1234 を許可しており、1234 は LM Studio。
- LM Studio が Origin 由来の拒否を起こすかは未確認。

## BDDシナリオ
Scenario: 必要性の裁定が記録される
  Given LM Studio に拡張機能の Origin でリクエストする
  When  実機で応答を確認する
  Then  「対策が必要 / 不要」の裁定と根拠が PBI に記録される

Scenario: 対策が必要な場合、Ollama の挙動は変わらない
  Given 対策が必要と裁定された
  When  ルール生成をプロバイダ非依存の仕組みに一般化する
  Then  Ollama 向けの既存ルール（対象 URL・ヘッダ操作）は byte-identical のまま、LM Studio にも同種のルールが適用される

## 受け入れ基準
- [ ] investigate: LM Studio 実機（または公式仕様）で Origin 拒否の有無を確認し、結果を記録した
- [ ] 不要と裁定された場合は、本 PBI を「不要」として閉じる
- [ ] 必要な場合、registry のフィールドでプロバイダごとの対象を宣言できる
- [ ] Ollama 向けの declarativeNetRequest ルールの内容が既存の golden と一致する
- [ ] 設定変更時の同期（observer）が複数プロバイダで正しく動くことをテストで pin した

## テスト戦略
- 調査: 実機確認の手順と結果を記録（investigate 型）
- 単体: ルール生成の golden と、設定変更時の同期
- 統合: `npm run validate`

## 見積もり
3 SP（要チームでの見積もり。調査のみなら 1 SP）

## Definition of Done
- [ ] 裁定が記録された
- [ ] 実装する場合は全BDDシナリオが自動テストとしてパスする
- [ ] type-check / lint / test / build が通る
