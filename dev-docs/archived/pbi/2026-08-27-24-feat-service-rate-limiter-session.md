# PBI: RateLimiter + SessionAlarms の Service 化

## ユーザーストーリー
開発者として、`rateLimiter.ts` の3関数と `sessionAlarmsManager.ts` の手作り singleton を `RateLimitService` / `SessionAlarmService` にクラス化したい、なぜなら `chrome.storage.session` + `chrome.storage.local` の二重書き込みと `chrome.alarms` の `alarmListenerSetUp` フラグが注入不能で `Date.now()`/`chrome.alarms`/`chrome.storage` なしに単体テスト不能だから。

## 優先度
- 順位: 3 / 7
- RICEスコア: 135（Reach=20 / Impact=3 / Confidence=60% / Effort=0.27）
- 根拠: セキュリティ境界 (ブルートフォース/自動ロック) が flat 関数でテスト不能。VULN-017/018 の再発領域で Impact 3。

## なぜなぜ分析
- なぜ flat か: 3関数が `chrome.storage.session` + `chrome.storage.local` を直叩きし `lockedUntil = max(session, local)` の二重書き込みを毎回実行
- なぜテスト不能か: `Date.now()`/`chrome.alarms`/`chrome.storage` が注入不能で `chrome` global mock なしに単体テスト不可
- 解: `RateLimitService(Clock+StoragePort)` と `SessionAlarmService(AlarmPort+Clock+StoragePort)` にクラス化し `encryptionSession` からは `authGuard.isLocked()` 1 seam のみを呼ぶ

## BDD受け入れシナリオ
Scenario: ハッピーパス — ブルートフォースが正しく制限される
  Given `RateLimitService` を生成する
  When 5回失敗する
  Then 30分ロックされる

Scenario: エッジケース — 自動ロックが正しく動作する
  Given `SessionAlarmService` を生成する
  When 30分経過する
  Then `lockSession` が呼ばれ、3回 retry される

## 受け入れ基準
- [x] `RateLimitService` が `Clock` + `StoragePort(session/local)` を注入される
- [x] `SessionAlarmService` が `AlarmPort` + `Clock` + `StoragePort` を注入される
- [x] `encryptionSession` からは `authGuard.isLocked()` 1 seam のみを呼ぶ
- [x] `ChromeAlarmPort`/`FakeAlarmPort` と `InMemoryStoragePort` で NTP skew や二重ロックを純粋テスト可能

## テスト戦略
- 単体: `RateLimitService` の `checkRateLimit` の `Clock` 注入テスト
- 単体: `SessionAlarmService` の `AlarmPort` 注入テスト
- 統合: 実 `chrome.alarms` + `chrome.storage` での E2E
- E2E: 不要

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
