# PBI: 回復オーナー判定の単一純粋関数化

## ユーザーストーリー
記録パイプラインの利用者として、失敗時の再試行責任が3箇所で食い違ってほしくない。なぜなら乖離は二重回復か回復漏れになるから。

## 優先度
- 順位: 04 / 12
- RICEスコア: 31.5（Reach=30 / Impact=1.5 / Confidence=0.7 / Effort=1.0）
- 根拠: 同ルール3箇所の将来乖離リスク。依存なし。

## 背景
arch診断A1。`targetEntryId!==undefined`ガードが2箇所＋obsidian系に第3コピー。StepExecutor→Outcome結合がErrorへの動的付着という暗黙seam。

## BDD受け入れシナリオ
Scenario: 判定が真理表で検証できる
  Given enqueued/targetEntryIdの組合せ
  When decideRecoveryOwnerを呼ぶ
  Then offline/pending/noneが一意に決まる

Scenario: Error付着が消える
  Given 失敗step
  When 実行する
  Then 戻り値・明示引数で回復可否が伝わる

## 受け入れ基準
- [x] 判定が1純粋関数に集約され3箇所の重複が消える
- [x] Error付着seamが撤去される
- [x] 真理表テスト＋orchestrator結合テストが緑

## テスト戦略
- 単体: 真理表テスト（Red→Green）
- 結合: orchestrator record()経由1本

## 見積もり
2.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）
