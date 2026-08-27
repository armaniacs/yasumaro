# PBI: pageState / contentCleaner デフォルト二重管理の解消

## ユーザーストーリー
開発者として、`pageState` と `contentCleaner` のデフォルトキーワード二重管理を解消したい、なぜなら片方だけ更新すると `loadSettings` 未取得時の挙動が食い違い再現困難なバグになるから。

## 優先度
- 順位: 6 / 7
- RICEスコア: 160（Reach=20 / Impact=1 / Confidence=80% / Effort=0.10）
- 根拠: 設定未取得時の挙動差は稀だが一旦発生するとデバッグ不能。SSOT化で Effort 小。

## なぜなぜ分析
- なぜ二重か: `pageState.ts:62` と `contentCleaner.ts:17` で別々の `DEFAULT_KEYWORDS` を定義
- なぜ気づかなかったか: 両モジュールが独立に開発され、共通化の責務が曖昧だった
- 解: `src/utils/contentCleaner.ts` の `DEFAULT_KEYWORDS` を SSOT とし `pageState` は import して使用

## BDD受け入れシナリオ
Scenario: ハッピーパス — デフォルトが一箇所から取得される
  Given `pageState` が `DEFAULT_KEYWORDS` を参照する
  When `loadSettings` 未取得で `isHardStripTarget` を呼ぶ
  Then `contentCleaner` と同じキーワードで判定される

Scenario: エッジケース — 将来キーワード追加時の更新漏れが起きない
  Given `DEFAULT_KEYWORDS` に新語を追加する
  When 両モジュールで判定する
  Then 両方で同じ新語が有効になる

## 受け入れ基準
- [x] `pageState.ts` が `contentCleaner.ts` の `DEFAULT_KEYWORDS` を import している
- [x] 両ファイルの重複定義が削除されている

## テスト戦略
- 単体: `pageState` と `contentCleaner` のキーワード一致を検証
- 統合: `loadSettings` 未取得時の `isHardStripTarget` 挙動を両モジュールで比較
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
