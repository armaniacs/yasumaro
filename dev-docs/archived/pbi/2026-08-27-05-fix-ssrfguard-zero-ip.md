# PBI: ssrfGuard 0.0.0.0 ブロック追加

## ユーザーストーリー
開発者として、`0.0.0.0` と `::ffff:0.0.0.0` が SSRF ブロック対象になるようにしたい、なぜなら `0.0.0.0/8` は localhost 相当で悪用可能な迂回経路だから。

## 優先度
- 順位: 1 / 7
- RICEスコア: 3600（Reach=60 / Impact=3 / Confidence=100% / Effort=0.05）
- 根拠: SSRF は外部メタデータ取得に直結 (Impact=3)。0.0.0.0 は高確実で Effort 極小。

## なぜなぜ分析
- なぜ迂回できるか: `isPrivateIpAddress` が `0.x` を private とみなさない
- なぜ見落としたか: 127/10/192/172 のみをテストし 0.0.0.0 を想定しなかった
- 解: `isPrivateIpAddress` に `a===0` 分岐を追加し `0.0.0.0/8` をブロック

## BDD受け入れシナリオ
Scenario: ハッピーパス — 0.0.0.0 はブロックされる
  Given `validateUrl("http://0.0.0.0:27123")` を呼ぶ
  When 判定する
  Then `private IP` エラーで拒否される

Scenario: エッジケース — 正常な外部 IP は許可される
  Given `validateUrl("http://8.8.8.8")` を呼ぶ
  When 判定する
  Then 許可される

## 受け入れ基準
- [x] `isPrivateIpAddress('0.0.0.0')` が `true` を返す
- [x] `isPrivateIpAddress('::ffff:0.0.0.0')` が `true` を返す
- [x] `validateUrlForAIRequests` で `0.0.0.0` がブロックされる

## テスト戦略
- 単体: `isPrivateIpAddress` に `0.0.0.0`, `0.1.2.3`, `::ffff:0.0.0.0` の境界値テスト
- 統合: `validateUrl` 経由の SSRF ブロック E2E
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
