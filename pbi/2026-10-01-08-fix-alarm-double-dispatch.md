# PBI: check_session_timeout alarm の二重ディスパッチ解消

## 優先度・backlog 出所・依存

- **優先度**: RICE 48.0（R=8 / I=3 / C=1.0 / Eff=0.5）、backlog 順位 1、NN08
- **出所**: [backlog: holistic-1001](./2026-10-01-00-backlog-holistic-1001.md) — holistic-code-review（holistic-code-improvement フェーズA）で検証済みの候補
- **依存**: なし（バッチA・ファイル非重複）。`compositionManifest.ts` / `service-worker.ts` を触る他候補との同時改修は避ける
- **種別**: fix

## ユーザーストーリー

ユーザーとして、セッション自動ロックの判定が alarm 発火のたびに正確に 1 回だけ走ってほしい。なぜなら、`checkTimeout()` が 2 回走ると自動ロック判定と `SESSION_LOCK_REQUEST` 通知が重複し、ロック経路の挙動推論とテストの信頼性が落ちるから。

## 背景（現状）

PBI 2026-09-15-15 の registry 移行で内部リスナーが撤去されず、両経路が wire された結果、`check_session_timeout` が発火するたびに `checkTimeout()` が 2 回実行される。

- `src/background/SessionAlarmService.ts:63` — `startTimeoutChecker()` が `setupAlarmListener()` を呼ぶ
- `src/background/SessionAlarmService.ts:191-202` — 内部 `alarms.onAlarm` リスナーが `checkTimeout()` を呼ぶ（`alarmListenerSetUp` ガード付き・1 リスナーのみ）
- `src/background/alarmRegistry.ts:141-145` — registry job `check_session_timeout` の `run` → `sessionTimeoutRunRef?.()` → `checkTimeout()`
- `src/background/service-worker.ts:189-192` — `setSessionTimeoutRefs()` が `checkTimeout` を run 側に wire
- `src/background/service-worker.ts:269` — `chrome.alarms.onAlarm.addListener(handleAlarm)` で registry が購読
- `src/background/service-worker.ts:42` — `sessionAlarmService.initialize()` → `startTimeoutChecker()`
- `src/background/service-worker.ts:48` — `alarmRegistry.installAll()` → job `install` → `sessionTimeoutInstallRef?.()` → `startTimeoutChecker()`

結果:

1. **alarm 発火ごとに `checkTimeout()` が 2 回実行される** — registry 経路（`handleAlarm` → `run`）と内部リスナー経路の両方が同じ alarm を受ける
2. **SW 起動時に `startTimeoutChecker()` が 2 回実行される** — :42 の直接呼び出し + :48 の install 経路 → `alarms.clear` / `alarms.create` も 2 回ずつ走る
3. `src/background/alarmRegistry.ts:42` — `sessionTimeoutChecker?: () => Promise<void>` が宣言のみで未読。`src/background/compositionManifest.ts:205` はそのためにだけ存在する死んだ wire

## BDDシナリオ

### Scenario: alarm 発火時に checkTimeout が 1 回だけ実行される

```gherkin
Given registry 経路が wire され、SessionAlarmService の内部リスナーが撤去されている
When `check_session_timeout` alarm が発火する
Then `checkTimeout()` は 1 回だけ呼ばれ、`sessionTimeoutRunRef` 経路が唯一の実行口である
```

### Scenario: SW 起動時に alarm の clear/create が二重に走らない

```gherkin
Given service worker が起動し `alarmRegistry.installAll()` が走る
When 起動シーケンスが完了する
Then `startTimeoutChecker()` は 1 回だけ実行され、`check_session_timeout` の `alarms.clear` + `alarms.create` は 1 回ずつである
```

### Scenario: 他の alarm job の dispatch に影響しない

```gherkin
Given registry に複数の job が登録されている
When `yasumaro-daily-purge` が発火する
Then `checkTimeout()` は呼ばれず、daily purge の `run` のみが走る
```

## 実装戦略

**It must keep behavior**: alarm 発火 → 自動ロック判定（`checkTimeout` → `lockSession` → 通知リトライ）という外部から観測可能な挙動は変わらない。`stopTimeoutChecker()` / `updateActivity()` / `lockSession` のリトライ（VULN-017 fix）も現状維持。変更は「実行回数を 1 回に寄せる」ことだけ。

方向性: SessionAlarmService の内部リスナーを撤去し registry 経路に一本化する。alarm 発火の唯一の実行口を `sessionTimeoutRunRef` 経路（registry `handleAlarm` → job `run`）とし、SW 起動時の `startTimeoutChecker()` を registry の install 経路に寄せて `alarms.clear` / `alarms.create` の二重化も解消する。未読の `sessionTimeoutChecker` dep は `AlarmHandlerDeps` と manifest のエントリから削除する。

### 受け入れ基準

- [x] 1. 内部リスナー（`setupAlarmListener()` / `alarmListenerSetUp` / 内部 `onAlarm` 登録）が撤去され、alarm 発火で `checkTimeout` が 1 回だけ走る
- [x] 2. `sessionTimeoutRunRef` 経路が `checkTimeout` の唯一の実行口である
- [x] 3. SW 起動時の `startTimeoutChecker()` 実行が 1 回になり、`alarms.clear` / `alarms.create` の二重実行が消える
- [x] 4. 未読の `sessionTimeoutChecker` dep が `AlarmHandlerDeps`（alarmRegistry.ts）と `compositionManifest.ts` のエントリから削除されている
- [x] 5. 既存の alarm 関連テストが green
- [x] 6. `npm run type-check` が通る

## テスト戦略

- **単体**（Vitest・注入済み `AlarmPort` / chrome global mock）:
  - `src/background/__tests__/SessionAlarmService.test.ts` — `startTimeoutChecker()` が `onAlarm` を登録しないことを監視。既存の clear/create アサーションは 1 回の実行で 1 回ずつを確認
  - `src/background/__tests__/alarmRegistry.test.ts` — `check_session_timeout` 発火で `run` が 1 回だけ走ること、`checkTimeout` spy の呼び出し回数が正確に 1 であることを明示（「2 回でも動く」では満たさない）
  - `src/background/pipeline/steps/__tests__/sessionAlarmsManager.test.ts` — 既存互換の green 確認
- **繰り返しゲート**（[TEST_RULE](../dev-docs/TEST_RULE.md) / AGENTS.md の Definition of done）: `npx vitest run src/background/__tests__/SessionAlarmService.test.ts src/background/__tests__/alarmRegistry.test.ts --repeats=20` を全回 green
- **コミット前ゲート**: `npm run validate`

## 実装内容

1. `src/background/SessionAlarmService.ts` — `startTimeoutChecker()` から `setupAlarmListener()` 呼び出しを削除し、`setupAlarmListener()` メソッド・`alarmListenerSetUp` フィールド・内部 `onAlarm` 登録を削除。`checkTimeout()` の doc コメント（:111）は「registry 経由の唯一の入口」であることを明記
2. `src/background/service-worker.ts` — :42 の `sessionAlarmService.initialize()` 直接呼び出しを撤去し、registry install（`sessionTimeoutInstallRef` → `startTimeoutChecker`）を唯一の start 経路にする。:40-47 のコメントを現状に合わせて更新。`initialize()` 自体は使用がゼロになれば削除してよい（テストが参照する場合は残す）
3. `src/background/alarmRegistry.ts` — `AlarmHandlerDeps` から未読の `sessionTimeoutChecker` を削除
4. `src/background/compositionManifest.ts` — factory から `sessionTimeoutChecker` エントリ（:205）を削除。`sessionTimeoutInstall`（:206）は読まれているため残す
5. 関連コメントの整合 — 「the alarm creation + listener live in the registry」など、内部リスナー撤去後と乖離する表現を更新

## Definition of Done

- [x] 受け入れ基準 1-6 をすべて満たす
- [x] alarm 発火 1 回に対する `checkTimeout` spy 呼び出しが正確に 1 のテストが存在する
- [x] SW 起動シーケンスで `alarms.clear` / `alarms.create` が 1 回ずつのテストが存在する
- [x] `npx vitest run <触れたテストファイル> --repeats=20` 全回 green
- [x] `npm run validate` green
- [x] 変更は実行回数の一本化のみで、ロック挙動・他 alarm job の dispatch は不変

## 実装記録（2026-10-02）

変更した内容:

- `SessionAlarmService.ts` — `setupAlarmListener()` メソッド・`alarmListenerSetUp` フィールド・`startTimeoutChecker()` からの呼び出し・内部 `onAlarm` 登録を削除。`checkTimeout()` の doc コメントを「registry の run hook 経由が唯一の入口」に更新
- `service-worker.ts` — `init()` から `sessionAlarmService.initialize()` の直接呼び出しを撤去し、registry の `installAll()` → `sessionTimeoutInstallRef` を唯一の start 経路にした。`setSessionTimeoutRefs` の run 側を `await` 付きに整齐え、refs が session-timeout job の唯一の wire であることをコメントで明示
- `alarmRegistry.ts` — `AlarmHandlerDeps` から未読の `sessionTimeoutChecker` を削除
- `compositionManifest.ts` — factory の `sessionTimeoutChecker` エントリを削除。`sessionAlarmService` の説明コメントを「生成はここ、dispatch は registry が所有」に更新

追加・更新したテスト:

- `SessionAlarmService.test.ts` — 「`startTimeoutChecker` が alarm リスナーを一切登録しない」を `listenerCount === 0` で固定（従来の「1 リスナー」前提は撤去）。`FakeAlarmPort.fire()` と `drainMacrotask()` / `vi.waitFor()` を削除し、チェック経路を `await service.checkTimeout()` で直接駆動するよう変更
- `alarmRegistry.test.ts` — `check_session_timeout` 発火で `run` がちょうど 1 回、他 job では 0 回、`installAll()` で install がちょうど 1 回（run は 0 回）の 3 ケースを追加

逸脱なし。`initialize()` は `src/background/sessionAlarmsManager.ts:27` から引き続き参照されるため実装内容 2 の「削除してよい」ではなく温存した。検証: `npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。
