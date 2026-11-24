# PBI: Obsidian 保存の 412 競合を利用者に通知し、履歴に理由を残す

## ユーザーストーリー
Obsidian のデイリーノートに記録を保存している利用者として、Obsidian 側の編集と競合して保存できなかったときに、そのことを通知で知り、あとから保留一覧で「競合で保存できなかった」と理由を確認したい、なぜなら現状は接続エラーと同じ文言(「Obsidian の接続を確認してください」)でしか残らず、接続設定を疑って時間を使ったり、保存されたと思い込んで記録を失ったりするから。

## 優先度
- 順位: 04/12
- RICE: 4.0(Reach 5 × Impact 2 × Confidence 0.8 / Effort 2)
  - Reach 5: Obsidian 連携を有効にし、Local REST API が強い ETag を返す環境の利用者。競合は Obsidian 側で同じノートを同時に編集したときに限られる
  - Impact 2: 無言の保存失敗(実質的な記録の欠落)を、利用者が気付いて再実行できる状態にする
  - Confidence 0.8: 通知の文言と、保留一覧の理由を新設するか既存の理由を細分化するかに設計判断が残る
  - Effort 2: 判定 1 箇所、理由 1 種、通知 1 行、i18n(en/ja)
- 根拠と依存: 依存なし。If-Match / 412 の実装(PBI 2026-11-23-04)の受け入れ基準「412 が競合として明示される(通知・履歴・理由で追跡可能)」の残りに当たる。07(監査 run-3)は本 PBI の完了後の最終コードを対象にする

## ビジネス価値
- 競合による保存失敗が、接続エラーと区別して利用者に伝わる
- 保留一覧から競合の記録を再実行でき、記録の欠落を防げる
- 測定方法: 412 が再書き込み後も続いたとき、競合専用の通知が 1 回出て、保留一覧に競合の理由で 1 件残ること(単体・統合テストで検証)

## BDD受け入れシナリオ

```gherkin
Scenario: 再書き込み後も 412 が続くと、競合の通知が出て保留一覧に理由が残る
  Given Obsidian 連携が有効で、デイリーノートの GET が強い ETag を返す
  And   PUT が 2 回続けて 412 を返す
  When  ページを記録する
  Then  「Obsidian 側の編集と競合したため保存できなかった」旨の通知が 1 回表示される
  And   保留一覧に、そのページが競合の理由で 1 件登録される
  And   SQLite など他の保存先への保存は通常どおり完了する

Scenario: 1 回目の 412 は再書き込みで解消し、通知も保留も出ない
  Given PUT が 1 回目だけ 412 を返し、2 回目は成功する
  When  ページを記録する
  Then  Obsidian への保存は成功し、通常の保存完了の通知が出る
  And   競合の通知は出ず、保留一覧にも登録されない

Scenario: 412 以外の書き込み失敗は従来どおりの扱いのまま
  Given PUT が 500 を返す
  When  ページを記録する
  Then  競合の通知は出ない
  And   保留一覧の理由は従来の「Obsidian書き込み失敗」のまま
```

## 受け入れ基準
- [ ] 412 が再書き込み 1 回の後も続いた場合だけ、競合専用の通知が表示される(1 回目の 412 で解消した場合と、412 以外の失敗では表示されない)
- [ ] 保留一覧(popup とダッシュボードの履歴パネル)に、競合を示す理由で表示される
- [ ] 通知の文言・保留一覧の理由の文言が i18n キーで定義され、`public/_locales/en/messages.json` と `public/_locales/ja/messages.json` の両方にある
- [ ] 通知にページタイトルを入れる場合は `sanitizePageTitleForNotification` を通す
- [ ] 通知・ログ・保留の内容に、ノートの本文、ETag の値、API キーを含めない
- [ ] regenerate(`targetEntryId` あり)の記録は、通知は出すが保留には登録しない(既存の `decideRecoveryOwner` の規則に従う)
- [ ] 既存の 412 再書き込みの挙動(`MAX_CONFLICT_REWRITES = 1`、毎回 GET からやり直す)を変えない

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加しない(Obsidian Local REST API の 412 を実ブラウザで再現する仕組みがない)。08(実機スモーク)の確認項目に、Obsidian 側で同じノートを編集しながら記録する手順を加えるよう依頼する

### 統合テスト
- `src/background/pipeline/__tests__/RecordingPipeline.test.ts`: ObsidianClient のモックが 412(`failure: { kind: 'http', status: 412, method: 'PUT' }`)を 2 回投げたとき、結果は success、保留は競合の理由で 1 件、通知の adapter が競合用に 1 回呼ばれること
- 同じく 500 のときは従来の `obsidian-write-failed` で、競合用の通知が呼ばれないこと

### 単体テスト
- `src/background/pipeline/__tests__/recordingOutcome.test.ts`: `finalizeSuccess` が、競合の PipelineError で競合の理由の保留と競合通知を出し、他の obsidian_sync エラーでは従来どおりであること。regenerate では保留を出さないこと
- `src/background/__tests__/notificationPolicy.test.ts`: 新しい通知行の payload(i18n の fallback を含む)を pin する
- `src/utils/__tests__/pendingStorage.test.ts`: 新しい理由の表示ラベル(i18n キーの対応)
- `src/background/pipeline/steps/__tests__/saveToObsidianStep-conflict.test.ts`: 既存の 3 件が緑のまま(挙動を変えない確認)

## 実装アプローチ
- **Outside-In**: 先に `RecordingPipeline.test.ts` に BDD のハッピーパスを統合テストとして書いて赤を確認し、内側(outcome の判定、通知の行、保留の理由)を順に単体テストで固めて緑にする
- **Red-Green-Refactor**: 競合の判定は既存の `isPreconditionConflict(resolveFailure(error))` を使い、新しい判定関数を増やさない。緑になった後、obsidian_sync エラーの扱いが 1 箇所にまとまっているかを見直す

## 見積もり
2 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `OutcomeAdapters`(notifier / pending / skipRecorder)が注入可能で、chrome API なしでテストできる
- 非機能要件: 通知は `NotificationHelper.show` の単一の書き込み点を通す。文言は `notificationPolicy.ts` の表に行を追加して持つ。アクセシビリティ上、保留一覧の理由はテキストで表示し、色だけで区別しない
- プライバシー: 保留に残すのは URL・タイトル・理由・既存の表示用エラーメッセージだけ(既存の `pendingEntry` と同じ範囲)

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。

```bash
rtk grep -n "decideConflictRewrite\|exhausted\|throw" /Users/yaar/Playground/yasumaro/src/background/pipeline/steps/saveToObsidianStep.ts
rtk grep -n "isPreconditionConflict\|MAX_CONFLICT_REWRITES" /Users/yaar/Playground/yasumaro/src/utils/obsidianConditionalWrite.ts
rtk grep -n "obsidianError\|obsidian-write-failed\|notifySaveSuccess\|interface OutcomeNotifier" /Users/yaar/Playground/yasumaro/src/background/pipeline/recordingOutcome.ts
rtk grep -n "ErrorPendingReason\|PENDING_REASON_MESSAGE_KEYS" /Users/yaar/Playground/yasumaro/src/utils/pendingStorage.ts
rtk grep -n "obsidian-write-failed" /Users/yaar/Playground/yasumaro/src/dashboard/captureFailureReasons.ts /Users/yaar/Playground/yasumaro/src/background/offlineQueueProcessor.ts
rtk grep -n "Failed to write to daily note" /Users/yaar/Playground/yasumaro/src/background/obsidianClient.ts
```

現状の流れ(コードで確認した事実):
1. `src/background/obsidianClient.ts` の `appendToDailyNote` が GET で強い ETag を得て、`withIfMatch` で PUT する。`_writeContent` は非 2xx で `failureFromHttpStatus(status, 'PUT')` を付けた Error を投げる。412 のときも文言は「Error: Failed to write to daily note. Please check your Obsidian connection.」(接続エラーと同じ)
2. `src/background/pipeline/steps/saveToObsidianStep.ts` が `decideConflictRewrite(resolveFailure(err), rewritesDone)` で 1 回だけ再書き込みする。`'exhausted'` のとき WARN ログ「Obsidian write conflict (412) persisted after the single rewrite」を出して同じ Error を投げ直し、外側の catch で ERROR ログを出して `toError(error)` を投げる。ステップのコメントどおり、通知はここでは出さない
3. `src/background/pipeline/savePhase.ts` の `saveObsidian` は `ErrorStrategy.BEST_EFFORT`、`offlineRetry: { jobKind: 'obsidian_sync' }`。412 は `kind: 'http'` で、`src/utils/failureTaxonomy.ts` の `FAILURE_RETRY_PROFILE.http.offlineRecovery` が false のため offline キューには入らない
4. `src/background/pipeline/recordingOutcome.ts` の `decideStepOutcome` が BEST_EFFORT のエラーを `PipelineError`(`recoveryKind: 'obsidian_sync'`)として `context.errors` に積む。`finalizeSuccess` がそれを見つけ、`decideRecoveryOwner` が `'pending'` なら `pendingEntry(context, 'obsidian-write-failed', error.message)` で保留に登録する。通知は `obsidianDuration` がある場合の保存完了通知だけで、失敗の通知は出ない
5. 保留の理由の型は `src/utils/pendingStorage.ts` の `ErrorPendingReason`(`'pipeline-error' | 'obsidian-write-failed' | 'local-ai-unavailable'`)。表示ラベルは `PENDING_REASON_MESSAGE_KEYS` → `pendingReasonObsidianWriteFailed`(ja: 「Obsidian書き込み失敗」)。`renderPendingReason` は `src/utils/pendingRowRenderer.ts` と `src/popup/popup.ts` から呼ばれ、`pendingRowRenderer.ts` は popup の `src/popup/pendingPages.ts` とダッシュボードの `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts` から使われる
6. 通知の文言の表は `src/background/notificationPolicy.ts`、書き込み点は `src/background/notificationHelper.ts` の `NotificationHelper.show`。BEST_EFFORT の保存先が自前で通知する前例は `src/background/pipeline/steps/webhookExportStep.ts`(`webhookExportNotifier`)

### 範囲
- 含める: 競合の判定(`finalizeSuccess` 内)、保留の理由の新設または細分化、競合通知の行と notifier の口、i18n(en/ja)、`captureFailureReasons.ts` の表への追加
- 含めない: 再書き込み回数の変更、ETag が無い環境での競合検出、Obsidian 側との差分マージ、offline キュー経由の再実行(`offlineQueueProcessor.ts`)での理由の細分化(412 は offline キューに入らないため。必要なら別 PBI)

### 実装手順
1. 設計を決める(推奨: 保留の理由に `'obsidian-write-conflict'` を新設する。既存の `'obsidian-write-failed'` の意味を変えないため。owner の確認が必要なら handoff に記録して進める)
2. `RecordingPipeline.test.ts` に 412 を 2 回投げる統合テストを書き、赤を確認する
3. `pendingStorage.ts` の `ErrorPendingReason` と `PENDING_REASON_MESSAGE_KEYS` に新しい理由を追加する。`isPrivacyPendingReason` の集合には入れない(再試行の対象として扱われる)
4. `recordingOutcome.ts`: `pendingEntry` の `reason` の型を広げる。`finalizeSuccess` で `obsidianError` が `isPreconditionConflict(resolveFailure(obsidianError.error))` を満たすとき、理由を競合にし、`adapters.notifier` の新しいメソッド(例: `notifyObsidianConflict(title)`)を呼ぶ。保留の登録は既存の `decideRecoveryOwner` の分岐の中に置き、通知は分岐の外に置く(regenerate でも通知は出す)
5. `OutcomeNotifier` に新メソッドを追加し、`prodNotifier` から `resultBuilder.ts` 経由で `NotificationHelper.show(<新しい policy 行>)` を呼ぶ。テストの fake notifier(`recordingOutcome.test.ts` など)にも追加する
6. `notificationPolicy.ts` に通知の行を追加する(タイトルは `sanitizePageTitleForNotification` を通す)。`notificationPolicy.test.ts` で payload を pin する
7. `public/_locales/en/messages.json` と `ja/messages.json` に通知のタイトル・本文・保留の理由のキーを追加する。`npm run check-i18n` で両言語の一致を確認する
8. `src/dashboard/captureFailureReasons.ts` の `CAPTURE_FAILURE_REASONS` に新しいコードを `category: 'storage'` で追加する(表のテストが未登録のコードを赤にする)
9. `npm run validate` で全体を確認する

### 落とし穴
- `PipelineError.error` は `unwrapStepFailure` 済みの元の Error。`toError()` で包み直されても `failure` の付け替えが保たれるかを、`resolveFailure` で確認するテストを書く(`saveToObsidianStep` の外側の catch が `toError(error)` を投げるため)
- 412 以外の http エラーにも `method: 'PUT'` は付く。判定は必ず status と method の両方を見る既存の `isPreconditionConflict` を使い、status だけで判定しない
- 通知を `saveToObsidianStep` の中で出すと、ステップのコメントにある責務の分担(通知は呼び出し側)を破る。offline の再実行経路(`saveRetry`)でも二重に通知が出るおそれがある
- `captureFailureReasons.ts` の `i18nKey`(`captureFailure_*`)は、`captureFailure_domainBlocked` 以外が `public/_locales` に見当たらなかった。新しい行の `i18nKey` を locale に追加するか、既存の行と同じ扱いにするかは、表の利用箇所(`src/utils/captureOutcome.ts`、`src/dashboard/panels/diagnostic/diagnosticsPanel.ts`)を確認してから決める(要確認)
- 保留の理由を新設すると、popup のテスト(`src/popup/__tests__/popup.test.ts`)と `pendingStorage.test.ts` の理由一覧の期待値が変わる
- i18n の文言に「接続を確認してください」を入れない。競合は接続の問題ではなく、再実行で解消する

## Definition of Done
- [ ] 全 BDD シナリオがテストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了(通知・保留に秘密情報やノート本文が入らないことを確認)
- [ ] ドキュメント更新済み(README の「Obsidianへの追加の仕組み」の競合時の説明に、通知と保留一覧への登録を追記。`dev-docs/API_ENDPOINTS.md` の If-Match 節に記述があれば追従)
- [ ] CHANGELOG の `[Unreleased]` に利用者向けの変更として記載

## 引き継ぎ
状態: 未着手。進捗と引き継ぎ情報は [handoff/2026-11-24-05-feat-obsidian-conflict-user-notice.md](handoff/2026-11-24-05-feat-obsidian-conflict-user-notice.md) に記録する(ファイルが無ければ未着手)。
