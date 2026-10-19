# PBI: 記録の実行を後から行う経路（オフライン再送・通知・定期要約）が同意を再確認しない問題の修正

## ユーザーストーリー

同意を撤回したユーザーとして、撤回より前に積まれた仕事（オフライン再送のキュー、画面に残った確認通知、週次・月次の要約ジョブ）が、撤回後に勝手に実行されてほしくない。なぜなら、キューやアラームや通知は「撤回より前に作られた」というだけの理由で動き続けてよいものではなく、撤回は「以後の処理を止めてくれ」という意思表示だから。とくにオフライン再送と定期要約は、撤回後に保存済み要約・本文・閲覧履歴を AI プロバイダと Obsidian へ送る。

## 優先度

- 順位: 2026-10-19 節の 10 / 11（同日 2026-10-19 の 11 件中 10 番目。RICE 480 は 03 と同帯）
- RICE: 480（Reach=400 / Impact=3 / Confidence=100% / Effort=2.5）
  - Reach: 同意機能を使ったことのある母数（03 と同じ 400 と推定）。このうち、撤回の前後 7 日以内にオフライン再送キューへ積まれたジョブを持つ層、確認通知が画面に残っている層、定期要約を有効化した層が実際に露出する
  - Impact: 3。撤回後に**保存済み要約・本文・閲覧履歴が外部（AI プロバイダ / Obsidian）へ出る**。同意の実効性そのものに関わる。3 経路のうちオフライン再送は 5 分間隔で自動実行されるため、撤回直後に確実に走る
  - Confidence: 100%。3 経路すべてをコード直読で確認し、`offlineQueueProcessor.ts` には同意の読み出しが 1 つも無いこと、通知ハンドラは `admit()` を経ずに `record()` を呼ぶこと、定期要約の唯一のガードが `REVIEW_SUMMARY_ENABLED` であることを grep で確認済み
  - Effort: 2.5 SP。実行時再確認の seam 追加（オフライン再送・通知・定期要約）＝ 1.4 / 拒否時のキュー保持と再試行回数の扱い＝ 0.4 / テスト 3 経路 ＝ 0.5 / 監査ガイドの表の更新 ＝ 0.2
- 種別: 非機能追加（fix）
- 難易度: 中
- 副作用: あり（同意撤回中は再送・要約が止まるため、「同意済みユーザーの積み残しが実行されない」時間帯が生じる。設計判断（実行時再確認か、撤回時にキューを破棄するか）を誤ると、同意済みユーザーの正当なキューを失う）
- 根拠: `dev-docs/SECURITY_REVIEW_GUIDE.md` の「Privacy-consent gating」表の行 8〜10 が「No — gap」として本 PBI を指している。同意の唯一のゲートは `RecordingAdmission`（`src/background/recordingAdmission.ts`）の admission 時 1 点であり、admission 後にタイマー・アラーム・キュー・ユーザー操作で走る経路は再確認しない（`dev-docs/SECURITY_REVIEW_GUIDE.md:149-153`）

## 背景（発見の経緯）

security-audit run-2（`pbi/2026-10-18-00-backlog-security-audit-run2.md`）の系譜。PBI `2026-10-19-02`（`dev-docs/archived/pbi/2026-10-19-02-fix-consent-gate-wiring-coverage.md`、同意ゲートの適用範囲 inventory）の実装と独立レビューで、「記録以外の外部送信」を棚卸しする過程で、admission 後の実行経路が同意を再確認しないことが判明した。PBI 02 は適用範囲をガイドの表として文書化するところまでで、実装は直していない（表の行 8〜10 が未修正のまま本 PBI を参照している）。

### 機構（コード上で確定、2026-10-19 にコード直読で確認）

1. **オフライン再送（admission 済みジョブの再生）**
   - `src/background/pipeline/stepExecutor.ts:67-74` — Obsidian / AI ステップが失敗し `step.offlineRetry` が立っていると `enqueueOfflineJob` して `StepFailureError(error, enqueued)` を投げる。ここでキューに積まれる。
   - `src/background/offlineNetworkQueue.ts:28` — `JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000`（7 日）。`MAX_RETRY_COUNT = 3`、`MAX_JOBS_PER_CYCLE = 20`。
   - `src/background/alarmRegistry.ts:165` — `yasumaro-offline-network-retry`（`periodInMinutes: 5`）。
   - `src/background/service-worker.ts:66` — `alarmRegistry.installAll()` が service worker の起動ごとに走る。MV3 では起動が頻繁なので、アラームは実質常時武装される。
   - `src/background/offlineQueueProcessor.ts:119` — `deps.recordingPipeline.retryObsidianWrite(...)` が Obsidian REST API へ送る。
   - `src/background/offlineQueueProcessor.ts:140` — `deps.recordingPipeline.record(buildOfflineRetryRequest(payload))` が AI プロバイダへ送る（フルパイプライン再実行）。
   - **このファイルには同意の読み出しが 1 つも無い。** `hasPrivacyConsent` も `admit` も import していない（`OfflineQueueProcessorDeps` は `offlineNetworkQueue` / `recordingPipeline` / `terminalFailureHandler` / `notifyError` のみ、`:75-86`）。
   - `src/utils/storage/privacyConsent.ts:285-329` — `withdrawPrivacyConsent()` は撤回記録を書き、拒否カウンタをリセットし、nav trail を切る。**キューを破棄も無効化もしない。**
   - 帰結: 同意して記録 → ステップ失敗でキュー投入 → ユーザーが撤回 → 5 分以内の再送で、保存済み summary / content が AI プロバイダと Obsidian へ送られる。

2. **通知の「保存」再実行**
   - `src/background/service-worker.ts:194` — `createNotificationHandlers({ record: (data) => recordingPipeline.record(data) })`。`admit` は渡っていない。
   - `src/background/handlers/recordingHandlers.ts:175` — 同意済みの記録が確認を要したとき `NotificationHelper.notifyPrivacyConfirm(...)` を出す。
   - `src/background/notificationHelper.ts:42-52` — button 0 = 保存（`requireInteraction: true` で画面に残る）。
   - `src/background/handlers/notificationHandlers.ts:77-95` — buttonIndex 0 で `deps.record(buildRecordRequest('notification-confirm', ...))` を直接呼ぶ。`admit()` も同意読み出しも無い。
   - pending ページの TTL は `PENDING_MAX_TTL_MS = 24h`（`src/utils/pendingStorage.ts:92`）。通知発行から最長 24 時間、撤回後に保存を押せる。
   - 帰結: 同意して記録 → 確認通知が残る → ユーザーが撤回 → 通知の「保存」を押す → `record()` が同意を見ずに走る。

3. **週次・月次の定期要約**
   - `src/background/reviewSummaryGenerator.ts:299` — 期間内の全行の `summary` を join して `aiService.generateSummary(...)` へ送る。
   - `src/background/reviewSummaryGenerator.ts:259-263` — 唯一のガードは `REVIEW_SUMMARY_ENABLED`。
   - `src/utils/storage/defaults.ts:173` — 既定 `false`。ただし一度有効化すると永続し、無効化されるまでアラームが武装され続ける。
   - `src/background/alarmRegistry.ts:169-174` — `yasumaro-review-weekly` / `yasumaro-review-monthly`（`installReviewSummary` が `REVIEW_SUMMARY_ENABLED` true のときだけ作成、`:124-136`）。
   - `src/background/handlers/MessageRouter.ts:233` → `src/background/handlers/systemHandlers.ts:347-349` — `GENERATE_REVIEW_SUMMARY` による手動起動も同じ生成器を通る。
   - 帰結: 同意して記録 → 定期要約を有効化 → ユーザーが撤回 → 次の週次 / 月次アラーム（または手動メッセージ）で、撤回済みの期間の全 summary が AI へ送られる。

## 再現手順

本 PBI の証拠はコード直読で確定している（実行は未実施。マシン高負荷のため着手前の実測は実装者が行う）。実装者が最初に通す決定的な手順:

1. オフライン再送: `createOfflineQueueProcessor`（`src/background/offlineQueueProcessor.ts:88`）に、`retryAll` が 1 件のジョブを渡す偽キューと、`record` / `retryObsidianWrite` のスパイを注入する。同意判定を「撤回済み」に固定して `processOfflineNetworkQueue()` を 1 回 await する。期待（現状）: `record` と `retryObsidianWrite` が呼ばれる。期待（修正後）: どちらも呼ばれない。
2. 通知: `createNotificationHandlers` に `record` のスパイを渡し、pending ページを 1 件 seed して `onButtonClicked(id, 0)` を await する。同意判定を「撤回済み」に固定する。期待（現状）: `record` が呼ばれる。期待（修正後）: 呼ばれない。
3. 定期要約: `createReviewSummaryGenerator` に `repo` が `REVIEW_SUMMARY_ENABLED: true` を返す InMemory repo と、`aiService.generateSummary` のスパイ、1 行を返す `sqliteClient.query` を渡し、同意判定を「撤回済み」に固定して `generateWeeklySummary()` を await する。期待（現状）: `generateSummary` が呼ばれる。期待（修正後）: 呼ばれず、`REVIEW_SUMMARY_LAST_GENERATED_WEEK` も進まない（再同意後に生成できるようにする）。

アラーム経由の再現（5 分間隔を実時間で待たない）: `createAlarmRegistry(fakeDeps)`（`src/background/alarmRegistry.ts:192`）でジョブ表を取り出し、`yasumaro-offline-network-retry` / `yasumaro-review-*` の `run(deps)` を直接 await する。`installAll()` の `chrome.alarms` 呼び出しは既存の `src/background/__tests__/alarmRegistry.test.ts` と同じ偽 deps で観測できる。

## 影響

- **撤回後の外部送信**: 撤回済みユーザーの保存済み summary / content が AI プロバイダと Obsidian へ出る。オフライン再送は 5 分間隔で自動、定期要約は週次 / 月次で自動。
- **撤回の意味の後退（GDPR Art.7(3) の趣旨）**: 撤回は「以後の処理を停止する」効果を持つとされる。撤回はユーザーの明示的な行為であり、撤回より前に作られたキュー・通知・アラームを理由に処理を続けることは、厳格な読みでは説明できない。少なくとも**実行時点で同意を再確認する**ことが最低線。
- **撤回と同時に nav trail を切る既存の扱いとの不整合**: `withdrawPrivacyConsent` は「撤回したのに記録が捕捉し続ける」経路（nav trail）を塞いでいる（`src/utils/storage/privacyConsent.ts:317-327`）。同じ問題意識がキュー・通知・定期要約には適用されていない。
- **監査上の未解消項目**: `dev-docs/SECURITY_REVIEW_GUIDE.md` の表の行 8〜10 が「No — gap」のまま残り、同意ゲートの適用範囲の記述が実装とずれ続ける。
- 同意の実効性は PBI `2026-10-18-05` の ack ガード（再付与の抑止）で部分的に守られているが、それは「同意なしに記録が再開する」経路の話であり、本件（admission 済みの後続処理）は別の穴。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. オフライン再送キューは撤回後に AI へ送らない
  Given 同意済みで記録が admission され、Obsidian または AI ステップの失敗でジョブがキューに積まれている
  And その後ユーザーが同意を撤回し、hasPrivacyConsent は false を返す
  When yasumaro-offline-network-retry アラームが再送を実行する
  Then recordingPipeline.record は呼ばれない（AI プロバイダへ送られない）
  And recordingPipeline.retryObsidianWrite は呼ばれない（Obsidian REST API へ送られない）

Scenario: 2. オフライン再送キューは撤回後に Obsidian だけへ送らない（obsidian_sync ジョブ）
  Given キューに type=obsidian_sync のジョブがあり、summary と markdown が payload に入っている
  And ユーザーが同意を撤回済みである
  When 再送サイクルが走る
  Then Obsidian への追記（retryObsidianWrite）は呼ばれない
  And ジョブは「送信失敗」として回復通知の対象にならない（同意の欠如は失敗ではない）

Scenario: 3. 撤回後に残った確認通知の Save は記録しない
  Given 同意済みのときに privacy-confirm 通知が発行され、pending ページが残っている
  And ユーザーが同意を撤回済みである
  When 通知の Save ボタン（buttonIndex 0）をクリックする
  Then record は一度も呼ばれない
  And pending ページは削除されず、再同意後に同じ操作を再試行できる

Scenario: 4. 定期要約は撤回後に AI へ送らない
  Given REVIEW_SUMMARY_ENABLED が true で、期間内に summary を持つ行が存在する
  And ユーザーが同意を撤回済みである
  When yasumaro-review-weekly（または -monthly）アラーム、もしくは GENERATE_REVIEW_SUMMARY が走る
  Then aiService.generateSummary は呼ばれない
  And REVIEW_SUMMARY_LAST_GENERATED_WEEK / _MONTH は更新されない（再同意後に生成できる）

Scenario: 5. 同意済みユーザーの積み残しは従来どおり実行される（回帰ガード）
  Given ユーザーが同意済みで hasPrivacyConsent は true を返す
  And オフライン再送キューにジョブがあり、pending ページと有効なレビュー要約ジョブがある
  When 再送サイクル / 通知 Save / 定期要約がそれぞれ走る
  Then 3 経路とも従来どおり実行され、成功時は TTL と再試行回数の消費が従来と同じである

Scenario: 6. 撤回 → 再同意のあいだキューを保持する（設計判断を採る場合）
  Given 同意撤回中に再送サイクルが 1 回以上走った
  And その後ユーザーが再同意した
  When 次の再送サイクルが走る
  Then 保持されていたジョブは通常どおり再送される（同意の欠如はジョブを破棄しない）
```

## 受け入れ基準

- [ ] 3 経路すべてで、**実行時点**に同意を再確認する。admission 時の同意判定に依存しない
- [ ] 撤回状態では、オフライン再送が AI プロバイダ / Obsidian のどちらへも送らない（シナリオ 1・2）
- [ ] 撤回状態では、確認通知の Save が `record()` を呼ばない（シナリオ 3）
- [ ] 撤回状態では、定期要約が `aiService.generateSummary` を呼ばず、`REVIEW_SUMMARY_LAST_GENERATED_*` を進めない（シナリオ 4）
- [ ] 同意済み状態では 3 経路とも従来どおり動く（シナリオ 5。既存テストが非退行）
- [ ] 同意の欠如を「送信失敗」として扱わない。具体的には、同意を理由にスキップしたジョブで `retryCount` を消費しない（消費すると 5 分 × 3 回でジョブが恒久破棄され、terminal failure の回復通知まで出る。`src/background/persistentRetryQueue.ts:196-203` / `offlineNetworkQueue.ts:28`）
- [ ] キューを保持するか撤回時に破棄するかを**明示的に決めて記録**する。保持する場合、撤回中は送らず、再同意後に通常再送されることをテストで固定する（シナリオ 6）
- [ ] 通知経路で拒否した場合、pending ページを削除しない（再同意後に再試行できる）
- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` の表の行 8・9・10 を「Yes」に更新し、「Why / where」列に**固定しているテストのファイル名**を書く（例: `src/background/__tests__/offlineQueueProcessor.test.ts` の同意スキップ、`src/background/handlers/__tests__/notificationHandlers.test.ts` の拒否、`src/background/__tests__/reviewSummaryGenerator-extra.test.ts` の同意ガード）。`dev-docs/SECURITY_REVIEW_GUIDE.md:149-153` のルール 2 と整合させる
- [ ] 実行時再確認は `RecordingAdmission` のシングルトン（`src/background/compositionManifest.ts:229-235`）または `hasPrivacyConsent` のどちらか一方に統一し、handler / processor 内で新しい同意判定を作らない
- [ ] 実時間待ちを追加しない（`dev-docs/TEST_RULE.md`）。5 分 / 7 日の経過は注入した時計で動かす
- [ ] `npm run validate` が緑

## テスト戦略

- 単体（オフライン再送）: `src/background/__tests__/offlineQueueProcessor.test.ts` の既存の deps 注入型（`createOfflineQueueProcessor({ offlineNetworkQueue: { retryAll }, recordingPipeline: { record, retryObsidianWrite } })`）に同意判定の seam を足し、撤回時は `record` / `retryObsidianWrite` が未呼び出し、同意時は呼び出しを pin する。同意スキップで `retryCount` が増えないことは、`PersistentRetryQueue` の flush を通した結合テストで固定する。
- 単体（通知）: `src/background/handlers/__tests__/notificationHandlers.test.ts` に拒否 / 許可の 2 系統を足す。`src/background/handlers/__tests__/notificationSingleFlight.test.ts` の deps 構築も新 seam に追随させる。
- 単体（定期要約）: `createReviewSummaryGenerator` の `repo` 注入（`CreateReviewSummaryGeneratorOptions`、`src/background/reviewSummaryGenerator.ts:34-41`）に同意読み出しを足し、撤回時は `generateSummary` 未呼び出し・`set` 未呼び出しを pin する。`src/background/__tests__/reviewSummaryGenerator-extra.test.ts` が既存の型。
- 統合（アラーム）: `createAlarmRegistry(fakeDeps)` でジョブ表を組み、`run(deps)` を直接 await する。`src/background/__tests__/alarmRegistry.test.ts` が「fake deps で dispatch を駆動する」既存の型。5 分間隔・週次/月次スケジュールの実時間は待たない。
- 既存 seam（実装者はこれを再利用する）:
  - 注入可能な sleep / delay: `StepDelayFn`（`src/background/pipeline/stepExecutor.ts:20-22`、コンストラクタ第 3 引数 `:35`）。再試行 backoff の実時間はテストで待たない。
  - 注入可能な時計 / キュー: `PersistentRetryQueue` の adapter と `ttlMs` / `maxRetryCount`（`src/background/persistentRetryQueue.ts:28-41`）、`OfflineNetworkQueue` の `QueuePort`（`src/background/offlineNetworkQueue.ts:228` 以降の NoOp port）。TTL 7 日と再試行 3 回は注入した時計 / 回数で動かせる。
  - アラームレジストリ: ファクトリ `createAlarmRegistry(deps)`（`:192`）と条件付き install フック（`installReviewSummary`、`:124-136`）。
- E2E: 不要（決定的な局所挙動）。ただしオフライン再送は実際の service worker 起動順（`service-worker.ts:66` の `installAll`）に依存するため、owner が隔離プロファイルで「同意 → 失敗でキュー投入 → 撤回 → 5 分待たずにアラームを手動実行」を 1 回観測する。

## 実装メモ（設計判断と対象ファイル）

### 対象ファイルと該当箇所

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/background/offlineQueueProcessor.ts` | 75-86 / 119 / 140 | `OfflineQueueProcessorDeps` と 2 つの送信点。同意の読み出しが無い |
| `src/background/pipeline/stepExecutor.ts` | 67-74 | 失敗ステップをキューへ積む（同意は admission 時の 1 回きり） |
| `src/background/offlineNetworkQueue.ts` | 28 / 131-137 | `JOB_TTL_MS = 7 日`、`retryAll` は `PersistentRetryQueue.flush` へ委譲 |
| `src/background/persistentRetryQueue.ts` | 146-203 | `handler` が false を返すと `retryCount` を消費。同意スキップの扱いを決める場所 |
| `src/background/alarmRegistry.ts` | 110-121 / 165 / 124-136 / 169-174 | 再送ジョブ、レビュー要約の install / run |
| `src/background/service-worker.ts` | 66 / 194 | `installAll()` と通知ハンドラの配線 |
| `src/background/handlers/notificationHandlers.ts` | 77-95 | buttonIndex 0 で `record()` を直接呼ぶ |
| `src/background/reviewSummaryGenerator.ts` | 34-41 / 259-263 / 299 | 生成器の注入点、唯一のガード、AI 送信点 |
| `src/utils/storage/privacyConsent.ts` | 285-329 | `withdrawPrivacyConsent()`。キューを破棄しない |
| `src/background/compositionManifest.ts` | 229-235 | 同意ゲートのシングルトン（`isRecordingAllowed: () => hasPrivacyConsent()`） |
| `dev-docs/SECURITY_REVIEW_GUIDE.md` | 144-173 | 適用範囲の表（行 8〜10 を本 PBI 完了時に Yes へ） |

### 実装者が決める設計判断: 実行時再確認か、撤回時のキュー破棄か

- **A. 実行時点で同意を再確認する（推奨・最低線）**
  - ジョブ / 通知 / 要約ジョブを実行する直前に `hasPrivacyConsent()`（または共有 `RecordingAdmission` のゲート）を読む。撤回中は送らない。
  - 利点: 同意済みユーザーの積み残しを失わない。再同意すればそのまま実行される。撤回 → 再同意という正当な往復を壊さない。
  - 欠点: 撤回中もジョブが storage に残る（要約本文・URL を含む）。TTL 7 日で自然消滅するが、その間は保持される。
  - 実装上の注意: 同意の欠如を「失敗」として `retryCount` に数えないこと（数えると 15 分でジョブが恒久破棄され、回復通知まで出る）。`PersistentRetryQueue` の `handler` 契約（boolean）を拡張するか、同意スキップを flush の前に判定して `toProcess` から外す。
- **B. 撤回時にキューを破棄・無効化する**
  - `withdrawPrivacyConsent()` でオフラインキューを消し、pending ページを消し、レビュー要約アラームを止める。
  - 利点: 撤回の意味が最も強い。保持ゼロ。
  - 欠点: **同意済みユーザーの正当な積み残しを失う**（撤回 → 再同意で戻ってこない）。撤回は取り消し可能な行為であり、失ったキューは復元できない。また `withdrawPrivacyConsent` に 3 つの副作用が増え、撤回の失敗経路が太る。
- **推奨: A を主とし、B は採らない。** GDPR Art.7(3) の「撤回後は処理を停止する」は、送信しないことで満たせる。A は「停止」を満たしつつ、ユーザーの作業を消さない。ただし受理基準のとおり、キューを保持する判断と、撤回中は送らないことをテストで固定する。どちらを選んだかを完了記録に残す。
- 通知経路は PBI `2026-10-18-04`（通知 Save に admission pre-stage を適用）と重複する。18-04 が先に入るなら、その `admit` seam を再利用して本 PBI の通知アームを「実行時再確認」として pin する。順序を決めて二重実装を避ける。

### 落とし穴

- **同意スキップを送信失敗として数えない。** `PersistentRetryQueue.flushUnlocked` は `handler` が false を返すと `recordFailedItem` を呼び、`retryCount` を増やす（`src/background/persistentRetryQueue.ts:196-203`）。`MAX_RETRY_COUNT = 3`、アラームは 5 分間隔なので、素朴に false を返すと約 15 分でジョブが恒久破棄され、`terminalFailureHandler.handOver` の回復通知まで出る（同意していないだけなのに「再試行が尽きました」と言われる）。
- **`MAX_JOBS_PER_CYCLE = 20`（`offlineNetworkQueue.ts`）との相互作用。** 同意スキップでキュー先頭が詰まると、後続の同意済みジョブが 1 サイクル 20 件の枠を消費して待たされる。スキップは `toProcess` から外すか、キューを詰まらせない順序を決める。
- **通知の pending ページを削除しない。** 現状は成功時に `removePendingPages([url])` を呼ぶ（`src/background/handlers/notificationHandlers.ts:99`）。撤回を理由に拒否したときに消すと、再同意しても再試行できない。既存の「recovery claim が取れないときは pending を残す」扱いと同じ方針にする。
- **定期要約は `REVIEW_SUMMARY_LAST_GENERATED_*` を進めない。** 撤回時に生成済みとしてマークすると、再同意後もその期間のダイジェストを二度と生成できない。スキップは「未生成のまま」にする。
- **`REVIEW_SUMMARY_ENABLED` の既定 false（`defaults.ts:173`）を根拠に「影響は小さい」と結論しない。** 一度でも有効化したプロファイルでは永続し、アラームが武装され続ける。撤回時にアラームを止めるかは上記の設計判断 B に含まれる。
- **`hasPrivacyConsent` の読み出しは非同期でキャッシュされうる。** 撤回直後の 1 サイクル分の猶予を許すかは決めてテストに書く（テストは注入した同意判定で決定的にする）。
- **層の制約。** `offlineQueueProcessor` / `reviewSummaryGenerator` は background 層、`privacyConsent.ts` は Layer 1。直接 import で層を壊さないよう、`compositionManifest` / `createBackgroundServices` から seam を注入する（既存の `deps` 注入の型に 1 つ足すのが最小）。
- **テストの時間依存。** 5 分 / 7 日 / 週次・月次を実時間で待たない。`StepDelayFn`、`PersistentRetryQueue` の `ttlMs`、`createAlarmRegistry` の `run` 直接実行を使う（`dev-docs/TEST_RULE.md`）。

### ロールバック手順

1. 3 経路は独立なので、1 経路ずつ revert できる（オフライン再送だけ撤回時に止める、など）。
2. revert 後は「未修正に戻る」ため、`dev-docs/SECURITY_REVIEW_GUIDE.md` の該当行を「No — gap」へ戻し、`pbi/00-INDEX.md` の状態も戻す。
3. revert で同意済みユーザーのキューが壊れないこと（キュー保持を選んだ場合、ジョブは減っていないこと）を `npm run validate` で確認する。

## 見積もり

2.5 SP（中）。内訳: 実行時再確認の seam 追加（オフライン再送・通知・定期要約）＝ 1.4 / 同意スキップと `retryCount` の扱い＝ 0.4 / テスト 3 経路＋アラーム結合 ＝ 0.5 / 監査ガイドの表の更新 ＝ 0.2。通知アームを PBI `2026-10-18-04` に委ねる場合は 2.0 SP 相当。

## Definition of Done

- [ ] BDD シナリオ 1〜6 が自動テストで実装されパス（シナリオ 6 は設計判断 A / B のどちらを採ったかを明記したうえで）
- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` の表の行 8・9・10 が「Yes」になり、各行に固定テスト名が書かれている
- [ ] キューを保持するか破棄するかの判断と理由が完了記録に残っている
- [ ] 同意の欠如を送信失敗として数えないことがテストで固定されている
- [ ] 実時間待ちが追加されていない（`dev-docs/TEST_RULE.md`）
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（ガイドの表、必要なら `src/background/offlineQueueProcessor.ts` / `reviewSummaryGenerator.ts` のコメント）

## 関連

- [PBI 2026-10-19-11: ダッシュボードの「Obsidian へ追記」が同意ゲートを通らない問題の修正](2026-10-19-11-fix-dashboard-obsidian-export-consent.md) — 同じ「admission 後の外部送信」クラス。タブルの行 11 を担当する
- [dev-docs/SECURITY_REVIEW_GUIDE.md](../dev-docs/SECURITY_REVIEW_GUIDE.md) — 「Privacy-consent gating」表の行 8〜10（本 PBI）と行 11（PBI 11）。ルール 2（admission 時の同意は後の実行を許さない）が本 PBI の根拠
- [pbi/2026-10-18-00-backlog-security-audit-run2.md](2026-10-18-00-backlog-security-audit-run2.md) — 発見の系譜（security-audit run-2）
- dev-docs/archived/pbi/2026-10-19-02-fix-consent-gate-wiring-coverage.md — 同意ゲートの適用範囲 inventory。本 PBI はその独立レビューで発見され、表の「gap」行として起票された
- [pbi/2026-10-18-04-fix-notification-consent-prestage.md](2026-10-18-04-fix-notification-consent-prestage.md) — 通知 Save への admission pre-stage。本 PBI の通知アームと重複するため実装順を決める
- [pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md](../dev-docs/archived/pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) — 同じ同意 lifecycle。同意レコードの読み出し前提が共通
- [pbi/00-INDEX.md](00-INDEX.md)
- [dev-docs/TEST_RULE.md](../dev-docs/TEST_RULE.md) — 実時間待ちの禁止と、注入した時計 / sleep の使い方
