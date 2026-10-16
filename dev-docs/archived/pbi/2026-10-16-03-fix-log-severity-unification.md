# PBI: ログ深刻度の不統一（cache 保存失敗の `logDebug`）を是正

## ユーザーストーリー
障害調査をする開発者として、キャッシュ保存失敗が見逃されない深刻度で記録されてほしい。なぜなら DEBUG 扱いだと運用ログ（INFO/WARN 採用）で失敗が不可視になり、原因追及ができないから。

## 優先度
- 順位: 03 / 11
- RICEスコア: 6.0（Reach=3 / Impact=0.5 / Confidence=1.0 / Effort=0.25）
- 根拠: 同一目的の修正が他所で WARN 採用済み。1行変更＋方針コメントで閉じる。

## 背景
`src/background/headerDetector.ts:134` がキャッシュ保存失敗を `logDebug` で記録する一方、同目的の修正（`sessionStore.ts:384-387` の緊急 flush、`migrationBackup.ts:277`）は WARN 採用。レビュー指摘 Low #11（Domain Logic）。

## BDD受け入れシナリオ
Scenario: キャッシュ保存失敗は WARN 以上で記録される
  Given `HeaderDetector` のキャッシュ保存が失敗する
  When ログ出力を検査する
  Then `logWarn` 相当以上の深刻度で記録される（または方針コメントに DEBUG 採用の根拠が残る）

Scenario: 正常系のログ量は変わらない
  Given キャッシュ保存が成功する
  When 動作させる
  Then 追加のログが出ない

## 受け入れ基準
- [x] `headerDetector.ts:134` が `logWarn` に揃う、または DEBUG 維持の根拠コメントが残る
- [x] `src/background/__tests__/` の headerDetector 系テストが全緑

## テスト戦略
- 単体: 既存テストで深刻度を検証（なければ1件追加）
- 既存: `npx vitest run src/background/__tests__/headerDetector*` 全緑

## 見積もり
0.25 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：1行の深刻度変更＋import）
- [x] ドキュメント更新済み（不要ならその旨を記録）
