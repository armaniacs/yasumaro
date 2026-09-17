# PBI: manualContentFetcher のタイムアウト時に tabs.onUpdated リスナーが残留する

優先度: 順位 2 / 2（RICE: 6.0 = Reach 3 / Impact 0.5 / Confidence 1.0 / Effort 0.25 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917c.md](2026-09-17-00-backlog-arch-review-0917c.md)（台帳）
依存: なし

## ユーザーストーリー

拡張機能のユーザーとして、手動記録・プレビュー機能を使ったときに、Service Worker内にリスナーが蓄積してほしくない。なぜなら `fetchFromTab` のタイムアウト時に `chrome.tabs.onUpdated` のリスナー解除が行われておらず、使うたびにリスナーが残留し続けるから。

## 背景（現状と課題）

- `src/background/manualContentFetcher.ts:112-124` の `fetchFromTab` は、対象タブの読み込み完了を待つために `chrome.tabs.onUpdated.addListener` でリスナーを登録する。
- 正常完了パス（`status === 'complete'` を検知）では `chrome.tabs.onUpdated.removeListener` が呼ばれリスナーが解除されるが、タイムアウトパス（一定時間待っても完了イベントが来ない場合）では `removeListener` の呼び出しがなく、登録したリスナーが残ったままになる。
- 影響は限定的: 手動記録・プレビュー機能を使うたびに1つずつリスナーが蓄積するリークであり、可視的な不具合（メモリ逼迫やクラッシュ）には至らない規模と見込まれる。Service Worker がMV3の仕様で頻繁に終了・再起動するため、実害が顕在化する前にリスナーごとリセットされる場面が多い。
- 一方でCLAUDE.mdの非交渉事項に「リスナー・インターバルのクリーンアップ（メモリリーク防止）」が明記されており、原則違反であることは明確。

## BDD受け入れシナリオ

```gherkin
Scenario: タブ読み込みがタイムアウトしてもリスナーが解除される
  Given fetchFromTab がタブの読み込み完了を待っている
  When 待機がタイムアウトする
  Then chrome.tabs.onUpdated.removeListener が呼ばれ、登録したリスナーが解除される

Scenario: 正常完了時の既存の解除動作に影響しない
  Given fetchFromTab がタブの読み込み完了を待っている
  When タブが読み込み完了イベントを発火する
  Then 従来通りリスナーが解除され、取得結果が返る
```

## 受け入れ基準

- [x] タイムアウトパスで `chrome.tabs.onUpdated.removeListener` が呼ばれる
- [x] 正常完了パスの既存の解除動作・戻り値が変わらない
- [x] リスナー登録・解除をモックしたテストで、タイムアウト時に解除が呼ばれることを確認する

## テスト戦略

- 単体: `chrome.tabs.onUpdated` をモックし、タイムアウトをシミュレートして `removeListener` が呼ばれることを検証
- 単体: 正常完了パスの既存テストが引き続きパスすることを確認（回帰）

## 見積もり

0.25 pt（🟢極小）— タイムアウト分岐に `removeListener` 呼び出しを1行追加する程度の修正。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新不要（内部実装の修正のみ）
