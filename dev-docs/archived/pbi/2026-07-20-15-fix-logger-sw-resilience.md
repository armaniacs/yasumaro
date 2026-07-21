# PBI: Logger の Service Worker 終了耐性強化 — alarms ベース flush

元指摘: Checking Team (High: SRE/Ops Specialist)

## 実装状況（調査日: 2026-07-20、状態: ⬜ 未着手）

## ユーザーストーリー

開発チームとして、`Logger` のバッチフラッシュが `setTimeout` に依存している現状を `chrome.alarms` ベースに変更し、Service Worker サスペンド時にも保留ログを確実に書き込みたい。なぜなら、SW は 30秒非アクティブで終了し、その前に flush が実行されないとログが失われるから。

## ビジネス価値

- 診断ログの信頼性向上
- Service Worker 終了時のデータ消失リスク低減
- プロジェクト既知パターン「Use alarms not timers」への準拠

## 前提・制約

- `src/utils/logger.ts:235` で `setTimeout(() => flushLogs(), BATCH_FLUSH_DELAY_MS)` を使用
- `chrome.runtime.onSuspend` (`logger.ts:244`) で `void flushLogs(true)` を fire-and-forget
- `SessionStore` クラス (`src/background/sessionStore.ts`) も `setTimeout` ベースのフラッシュを使用しており、関連する可能性がある
- `chrome.alarms` API は既に他箇所 (`sessionAlarmsManager.ts`) で使用

## BDD受け入れシナリオ

```gherkin
Feature: Logger service worker resilience

  Scenario: Batch flush uses chrome.alarms instead of setTimeout
    Given logs are queued
    When the batch flush delay elapses
    Then a chrome.alarms event triggers flushLogs
    And setTimeout is not used for scheduling

  Scenario: Service Worker suspend awaits flush with timeout
    Given unflushed logs exist
    When chrome.runtime.onSuspend fires
    Then flushLogs(true) is awaited
    And a timeout ensures the SW does not hang indefinitely

  Scenario: Critical logs are not lost on SW termination
    Given a critical error is logged
    When the SW terminates before the next alarm
    Then the critical log is persisted to chrome.storage.session or local
```

## 受け入れ基準

- [ ] `logger.ts` の `setTimeout` ベースのバッチフラッシュを `chrome.alarms.create` に置き換え
- [ ] `onSuspend` ハンドラで `void flushLogs(true)` → `await flushLogs(true)` に変更（3秒タイムアウト付き）
- [ ] クリティカルログは即時 flush するか、`chrome.storage.session` への直接書き込みを検討
- [ ] `flushTimer` 変数と関連ロジックを整理
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `logger.test.ts` に `chrome.alarms` モックを追加し、アラーム発火で flush されることを検証
- `onSuspend` の await 動作を検証

### 統合テスト
- Service Worker 終了シナリオをシミュレートし、ログが失われないことを確認

## 実装アプローチ

- **Inside-Out**: `flushTimer`/`scheduleFlush` 周りを `chrome.alarms` ベースに書き換え
- `BATCH_FLUSH_DELAY_MS` を `chrome.alarms.create({ when: Date.now() + BATCH_FLUSH_DELAY_MS })` に対応
- `onSuspend` では `Promise.race([flushLogs(true), sleep(3000)])` を使用

## 見積もり
3pt（alarms 移行 + onSuspend 強化 + テスト）

## 副作用
🟡 軽微 — `chrome.alarms` の最小間隔は 1分（Chrome 制限）であり、現状の数秒単位の flush 遅延を維持する場合は即時 flush ベースに変更する必要がある。アラームを使う場合、ログの遅延は長くなる。

## 落とし穴
- `chrome.alarms` は最小 1分間隔。現状の「数秒後にバッチ flush」という挙動を維持したい場合、alarms は向かない。その場合は「バッファサイズ到達時に即時 flush」する設計に変更する必要がある。
- `SessionStore` も同様の課題を持つ。両方を同時に見直すか、Logger のみ先に対応するかを決める。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加/更新されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
