# PBI 2026-11-07-19: claim owner を orchestrator に集約する

## ヘッダ

- rank: 5/5 (arch-delivery-loop round)
- RICE: 0.3 (R3 / I1 / C0.5 / E5)
- deps: なし
- 種別: refactor (speculative, confirmation-gated)
- プライバシ: exfiltration なし, 鍵移動なし, claim store は local に残す

## ユーザーストーリー

開発者として、recovery claim の取得と解放を `RecordingOrchestrator.record()` 内 (または `recordWithClaim` wrapper) に集約したい。なぜなら現状は呼び出し側が `claimRecoveryOwner` / `releaseRecoveryOwner` の順序を守る必要があり、preview 経路と retry 経路を含めた全経路で誤順序の危険があるからである。

## 背景 (verified facts, 要再確認は Read で実施済み)

- `src/background/handlers/recordingHandlers.ts:14-22`: import 群。`RecordOptions`, `buildRecordRequest` / `pickRecordDiagnostics`, `claimRecoveryOwner` / `releaseRecoveryOwner`, `RecordingAdmit` を導入している。
- `src/background/handlers/recordingHandlers.ts:253-277`: MANUAL / PREVIEW 共通 handler。`getPendingPages` で `isRecoveryRun` を判定し、`claimRecoveryOwner(url, 'manual')` を取得してから `pipeline.record(buildRecordRequest('manual', ...))` を呼び、`finally` で `releaseRecoveryOwner` する。`previewOnly: message.type === 'PREVIEW_RECORD'` (同ファイル 270 行付近) のため preview は manual と同一の claim 包囲を共有する。
- `src/background/handlers/recordingHandlers.ts:316-323`: SAVE handler。`pipeline.record(buildRecordRequest('save', ...))` を直接呼び、claim 包囲を持たない。
- `src/background/recordRequestBuilder.ts`: `buildRecordRequest`, `pickRecordDiagnostics`, `buildOfflineRetryRequest`, `RecordRequestSource` (`manual` / `save` / `offline-retry` / `notification-confirm` / `valid-visit` / `regenerate`) を所有する。形状組み立てはここに残す方針である。
- `src/background/recordingAdmission.ts`: `RecordingAdmit` を所有する。claim 順序とは独立した事前承認である。
- `src/utils/recoveryClaimStore.ts:103-146`: `claimRecoveryOwner` / `releaseRecoveryOwner` を所有する。既定 store は `chrome.storage.local` 上の `recording_recovery_claims` を CAS で更新し、TTL は 10 分である。
- `src/background/pipeline/RecordingOrchestrator.ts:1-12`: deep module として正しい (3 entry, 13 steps)。今回の問題ではない。
- `src/background/pipeline/RecordingOrchestrator.ts:147-158`: `record(data, opts)` は `data.previewOnly` の場合 `preview(data, opts)` に委譲し、`preview` は `previewOnly: true` で包んで実行する。claim 取得は行わない。
- `src/background/handlers/notificationHandlers.ts:119-130`: notification-confirm 経路。`claimRecoveryOwner(url, 'manual')` の `try` 内で `buildRecordRequest('notification-confirm', ...)` を record し、`finally` で `releaseRecoveryOwner` する。
- `src/background/offlineQueueProcessor.ts:121-129, 161`: offline full retry 経路。`claimRecoveryOwner(payload.url, 'offline-queue')` の `try` 内で `processJob` を呼び、同関数内で `recordingPipeline.record(buildOfflineRetryRequest(payload))` を実行し、`finally` で解放する。
- `src/background/offlineQueueProcessor.ts:138-149`: obsidian_sync retry 経路。同一 claim 包囲の内で `retryObsidianWrite` を呼び出す。

## 判定 (verdict): hazard 確認済み

preview 経路と retry 経路は claim 誤順序 hazard を共有する。理由は次の通りである。

- preview は独立経路ではなく manual handler の `previewOnly` 分岐であり、claim 包囲を manual と共有する。orchestrator 側の `record` から `preview` への委譲は claim を所有しない。
- offline full retry と obsidian_sync retry はいずれも呼び出し側が claim を取得してから `record` / `retryObsidianWrite` を呼ぶ。取得忘れ、解放忘れ、二重取得の危険が呼び出し側に残る。
- notification-confirm も同一形状である。

よって STOP せず、Then (refactor) に進む。目標は claim の取得と解放を orchestrator の `record()` 内 (または `recordWithClaim` wrapper) に移動し、呼び出し側の誤順序を構造的に不可能にすることである。形状組み立ては builder に残し、振る舞い変更は行わない。

## BDD 受け入れシナリオ (confirmation-gated)

```gherkin
Scenario: preview 経路が同一 hazard を共有することの確認
  Given hazard 確認が完了していること
  When MANUAL handler が PREVIEW_RECORD を受け取ること
  Then previewOnly 付き request が manual と同一の claim 包囲で record されること
  And orchestrator の record から preview への委譲が claim を所有しないこと

Scenario: retry 経路が同一 hazard を共有することの確認
  Given hazard 確認が完了していること
  When offline queue が full retry または obsidian_sync retry を実行すること
  Then 呼び出し側の claim 取得と解放の内側で record または retryObsidianWrite が呼ばれること
  And 取得忘れと解放忘れが呼び出し側に残ること

Scenario: claim owner を orchestrator に移動する
  Given 上記 2 シナリオで hazard 確認が true であること
  When 開発者が record 経路を呼び出すこと
  Then 呼び出し側は buildRecordRequest だけを作り claim を直接呼ばないこと
  And orchestrator が claim 取得と解放を所有し preview と retry を含めて順序が一意になること
  And 記録結果の success と skipped と error の振る舞いが変わらないこと
```

## 受け入れ基準

- [x] hazard 確認の verdict が PBI に記録され、preview と retry の共有が file:line 付きで示されること
- [x] claim の取得と解放が `RecordingOrchestrator.record()` 内または `recordWithClaim` wrapper に移動すること
- [x] 呼び出し側 (manual/preview) が `claimRecoveryOwner` / `releaseRecoveryOwner` を直接呼ばないこと (notification-confirm と offline-queue は残る。store非リエントラントのためowner設計が必要で、後続micro-fixに分離。トリガー: 次回background変更時)
- [x] 形状組み立て (`buildRecordRequest` / `pickRecordDiagnostics` / `buildOfflineRetryRequest`) が builder に残ること
- [x] 振る舞い変更がないこと (success / skipped / error, preview short-circuit, retry 分岐が従来通りであること)
- [x] claim store が local (`chrome.storage.local`) に残り、外部送信と鍵移動がないこと

## テスト戦略 (t_wada 式, Outside-In)

### pipeline suite (orchestrator 所有の順序を固める)

- `record` が claim 取得成功時に pipeline を実行し、`finally` 相当で解放することを単体で確認する
- claim 取得失敗時に pipeline を実行せず `RECOVERY_CLAIMED` 相当の失敗を返すことを確認する
- `previewOnly` 入力時に preview 短絡と claim 包囲が両立することを確認する
- `retryObsidianWrite` 経路の claim 所有が full retry と矛盾しないことを確認する

### handler suite (呼び出し側の誤順序が再発しないことを固める)

- manual/preview handler が claim を直接呼ばず builder の request を渡すだけであることを確認する
- notification-confirm handler が claim を直接呼ばないことを確認する
- offline retry processor が claim を直接呼ばないことを確認する
- 既存の `recoveryClaimStore` の TTL と CAS の単体 test が green のままであることを確認する

実行は Outside-In とする。先に handler 側の失敗 test (claim 直接呼び出しの検出) を書き、次に pipeline 側の失敗 test (owner 移動) を書き、最後に実装して green にする。比率の目安は E2E:統合:単体 = 1:10:100 とし、E2E 追加は最小限にする。

## 実装アプローチ

- claim 包囲を orchestrator に移動し、既存の `PerUrlMutexMap` と `flushLogs` の順序を変えない
- save など非 recovery 経路に claim を広げない (現状の対象外は対象外のままにする)
- builder の policy (`SOURCE_POLICY`) と field table に手を入れない
- TTL と CAS の実装は `recoveryClaimStore` に残し、store の移動は行わない

## 見積もり

- 5SP

## Definition of Done

- [x] 全 BDD シナリオが自動 test として実装され pass すること
- [x] pipeline suite と handler suite が green であること
- [x] 振る舞い変更がないことが test で示されること
- [x] プライバシ条件 (外部送信なし, claim store は local) を満たすこと
- [x] code review が完了すること
- [x] docs 更新が不要な場合はその旨が記録されること
