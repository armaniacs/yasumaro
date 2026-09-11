# PBI 04: popup GET_CONTENT 送信 seam を ContentFetchGateway に統合 + permission listener 漏れ修正

## ユーザーストーリー

手動記録・ステータス表示・クレンジングフィードバックを使う利用者として、タブからのコンテンツ取得がどの経路でも一定の timeout / エラー処理で動いてほしい。なぜなら現状 3 箇所の別実装があり、2 箇所は timeout 無しでハングの恐れがあるから。

## 優先度

- 順位: 04 / 9
- RICE スコア: 25.6（Reach=4 / Impact=2 / Confidence=80% / Effort=0.25 人週）
- 根拠（2026-09-11 診断）:
  - `src/popup/recordCurrentPage/tabContentFetcher.ts:25-33` — Promise.race 5s timeout + permission ladder あり（唯一の深い実装）
  - `src/popup/statusPanel.ts:51-55` / `:468-475` — 生 callback `chrome.tabs.sendMessage` で timeout 無し（2 コピー）
  - `tabContentFetcher.ts:31-33` と `messageTransport.ts:71-74` — promise 版 `sendMessage` 後の `chrome.runtime.lastError` ポーリングは callback 時代の残骸で到達不能
  - `statusPanel.ts:147` — 未許可 URL 描画のたびに `addEventListener('click', …)` を積み重ね（ハンドラ重複 → 二重 prompt / 二重記録の恐れ）

## BDD 受け入れシナリオ

```gherkin
Scenario: statusPanel のコンテンツ取得に timeout がある
  Given content script が応答しないタブがある
  When  statusPanel が GET_CONTENT を送る
  Then  5 秒で timeout し、ハングしない

Scenario: permission ボタンのハンドラが重複しない
  Given 未許可 URL のステータス表示が 2 回更新される
  When  permission 要求ボタンをクリックする
  Then  requestPermission は 1 回だけ呼ばれる

Scenario: 死んだ lastError ポーリングが消えている
  Given ContentFetchGateway 実装
  When  promise 版 sendMessage が reject する
  Then  rejection が timeout/エラー分類に流れる（lastError 分岐は存在しない）
```

## 受け入れ基準

- [x] `ContentFetchGateway`（新規）に `fetch(tabId): Promise<ContentResponse>` の 1 seam で timeout + permission ladder + byteStats/cleanseStats 選択を集約。`MessageTransport` を adapter として注入
- [x] `statusPanel.ts` の 2 生コピーと `tabContentFetcher` の重複が gateway 参照に置き換わる
- [x] 到達不能な `lastError` ポーリング 2 箇所（tabContentFetcher / messageTransport）を削除
- [x] `statusPanel.ts:147` の permission ボタン配線に `dataset.wired` ガード（`previewView.ts:109` と同一パターン）を適用
- [x] popup 関連テスト green（新規 gateway テスト含む）

## テスト戦略

- 単体: gateway の timeout・rejection 分類・permission ladder を fake transport で検証
- 単体: permission ボタン配線の 1 回ガード
- 既存: recordCurrentPage / statusPanel テスト green

## 見積もり

S-M（0.25 人週）。種別: refactor（+fix 1 件）。

## 実装アプローチ

1. `ContentFetchGateway` 新設（tabContentFetcher の深い実装を移設・一般化）
2. statusPanel 2 箇所を gateway 経由に置換、lastError 死滅コード削除
3. permission listener の wired ガード
4. テスト

## 実装メモ（2026-09-11）

- `src/popup/contentFetchGateway.ts` 新設: `requestContentFromTab`（promise + timeout、permission prompt 無し、null返し）+ `ContentFetchGateway.fetch`（旧 TabContentFetcher の permission ladder を移設）。transport 注入点付き。
- tabContentFetcher.ts は削除（recordSession / barrel / 3 テストファイルを gateway 参照に更新）。
- statusPanel の 2 生 callback コピーを gateway 経由に置換。messageTransport の到達不能 lastError ポーリングを削除（契約コメント付き）。
- btnRequestPermission に dataset.wired ガード（previewView.ts:109 と同一パターン）。
- 旧テストが pin していた dead lastError 経路 2 件は promise 契約（resolved で lastError 無視・reject で ladder）に意図を修正。
