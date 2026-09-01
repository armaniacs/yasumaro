# PBI: Messaging Transport の MessageTransport 統一

## ユーザーストーリー
開発者として、2系統の `chrome.runtime.sendMessage` seam (`sendServiceWorkerMessage` + `ChromeMessageSender#sendMessageWithRetry`) を `MessageTransport` 深いモジュールに統一したい、なぜなら `Message{type,payload}` と `ExtensionMessage{type,payload,protocolVersion}` が並存し、リトライ/型/バージョン付与が乖離して `VALID_VISIT` の `isRetryableError` 判定差で本番のみの flaky を生むから。

## 優先度
- 順位: 1 / 7
- RICEスコア: 420（Reach=90 / Impact=2 / Confidence=70% / Effort=0.30）
- 根拠: 全記録パスが通過する最頻 seam。2系統の `Message` 型が恣意的に選択され `protocolVersion` 付与と `ResponseForType<T>` 型安全性が `retryHelper` 経路では失われる。

## なぜなぜ分析
- なぜ二重か: `types.ts:309` の `sendServiceWorkerMessage` は typed だがリトライなし、`retryHelper.ts:88` の `ChromeMessageSender` はリトライありだが `Message{type,payload}` を別定義
- なぜ気づかないか: 各経路単体テストは `chrome.runtime.sendMessage` を mock しリトライ分岐をカバーしない
- 解: `MessageTransport { send<T>(msg, {retries, clock}) }` に `MessageValidator` 登録と `RetryPolicy` (Clock注入) を統合。`types.ts` の3ラッパは薄いエイリアスに縮退

## BDD受け入れシナリオ
Scenario: ハッピーパス — 1 seam でリトライとバージョン付与が完結する
  Given `MessageTransport` を生成する
  When `send({type:'VALID_VISIT', payload})` を呼ぶ
  Then `protocolVersion` が自動付与され、リトライ可能なエラーのみ指数バックオフで再送される

Scenario: エッジケース — 型安全性が失われない
  Given `retryHelper` 経路で `VALID_VISIT` を送る
  When 送信する
  Then `protocolVersion` 付与と `ResponseForType` 型チェックが維持される

## 受け入れ基準
- [x] `MessageTransport` が `send<T>(msg, {retries, clock})` の1 seam を提供する
- [x] `MessageValidator` 登録と `RetryPolicy` が内部で統合されている
- [x] `src/messaging/types.ts` の3ラッパが `transport.send` への薄いエイリアスに縮退している
- [x] `retryHelper.ts` の `ChromeMessageSender` が削除されている

## テスト戦略
- 単体: `MessageTransport` の `send` のリトライ/型/バージョン付与テスト
- 統合: `extractor` と `previewFlow` の両経路で `VALID_VISIT` が正しくリトライされることを検証
- E2E: `content-script-recording` で `VALID_VISIT` の flaky が解消されることを検証

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

## 実装メモ

2 段階で完了した。

**第 1 段階（初回アーカイブ時）**: `MessageTransport`（`src/messaging/messageTransport.ts`）を新設し、
`src/messaging/types.ts` の `sendServiceWorkerMessage` / `sendFromContentScript` /
`sendFromPopup` を `transport.send` の薄いエイリアスに縮退。

**第 2 段階（2026-09-01、branch `refactor/pbi-22-remove-chrome-message-sender`）**:
受け入れ基準「`ChromeMessageSender` が削除されている」が第 1 段階では未達だったことが
`autonomous-task-closer` の洗い出しで判明。`src/utils/retryHelper.ts`（`ChromeMessageSender` /
`createSender` / `sendMessageWithRetry` / 並存する `Message` 型）を全削除し、
残る 3 consumer を移行:
- `src/content/contentMessageSender.ts` を新設（`MessageTransport` + `ChromeTransport` の
  薄いアダプタ、`createContentMessageSender(retries)`）
- `contentKernel.ts` / `extractor.ts` が `createContentMessageSender(2)` を使用
- `visitReporter.ts` が `Message` / `ServiceWorkerResponse` 型を自身で保持（唯一の利用者）
- `previewFlow.ts` が `messageTransport.send(msg, { retries: 5 })` を直接呼ぶ
- 影響テスト 5 ファイル（`extractor.test.ts` / `extractor-comprehensive.test.ts` /
  `recordCurrentPage{,-extra}.test.ts` / `main.test.ts`）の mock を
  `retryHelper.js` → `contentMessageSender.js` / `messageTransport.js` に張替
- `retryHelper.test.ts` を削除（アサーションは `messageTransport{,-branch}.test.ts` が既にカバー）
