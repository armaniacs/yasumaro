# PBI: pipeline層のfire-and-forget解消 - outcome登録のsettle化

## ヘッダ

- rank: 1/5
- RICE: 4.8 (R6 / I2 / C0.8 / E2)
- 依存: なし
- テーマ: systematic fire-and-forget repetition in pipeline layer
- 種別: fix
- 日付: 2026-11-07

## ユーザーストーリー

開発者として、記録パイプラインのoutcome登録の非同期破棄をなくしたい。なぜなら未処理のrejectionを消し、オフライン登録の取りこぼしをログで見える化できるから。

## 背景

記録パイプライン層でfire-and-forgetの繰り返しが残っている。代表例はoutcome層の2つのadapterである。

- `src/background/pipeline/recordingOutcome.ts:82-86`: `prodPending.addPending` が `void addPendingPage(entry)` で破棄している。確認済み。
- `src/background/pipeline/recordingOutcome.ts:88-92`: `prodSkipRecorder.recordSkip` が `void recordSkipReason(reason)` で破棄している。確認済み。
- 耐久性の前例: `src/background/pipeline/RecordingOrchestrator.ts:221` 付近の `executeInternal` の `finally` で `await flushLogs` している。確認済み。
- 耐久性の前例: `src/background/pipeline/RecordingOrchestrator.ts:173` 付近の `retryObsidianWrite` の `finally` で `flush` している。確認済み。
- 注入可能な遅延の前例: `src/background/pipeline/stepExecutor.ts:19` の `StepDelayFn`。確認済み。
- 失敗を丸める前例: `src/background/pipeline/stepExecutor.ts:130-137` の `catch (enqueueError)` がログ後に `return false` に畳んでいる。確認済み。

提案は次のどちらかである。

- 案A: 2つのrecorder methodの戻りを `Promise<void>` に変え、呼び出し側で `await` する。
- 案B: 破棄を `settlePending` のようなwrapperに集約し、落とした事実を `addLog` で記録する。

いずれも振る舞い保持が条件である。効果はunhandled rejectionの撲滅と、沈黙するオフライン登録落ちの可視化である。

残課題(対象外): `saveLocalMarkdownStep.ts:116-117` と `webhookExportStep.ts:19,136` のcatch握りつぶしは今回の作業に含めない。grepのみで未精査のため要確認。

## BDD受け入れシナリオ

```gherkin
Scenario: pending登録が失敗しても未処理rejectionにならない
  Given 記録パイプラインがFATAL系エラーを処理している
  And `addPendingPage` が失敗する状態である
  When `decideStepOutcome` がpending登録を行う
  Then 処理は例外で落ちずに結果を返す
  And 失敗の事実が `addLog` のERRORまたはWARNで残る

Scenario: skip理由の記録が失敗してもパイプラインが止まらない
  Given 記録パイプラインがPrivatePageまたはDuplicateを処理している
  And `recordSkipReason` が失敗する状態である
  When `decideStepOutcome` がskip理由を記録する
  Then 処理は例外で落ちずに結果を返す
  And 失敗の事実が `addLog` で残る

Scenario: 正常系の振る舞いは変わらない
  Given `addPendingPage` と `recordSkipReason` が成功する状態である
  When 記録パイプラインが成功と失敗の各分岐を通る
  Then 従来と同じ `RecordingResult` と通知とpending登録が行われる
```

## 受け入れ基準

- [x] `recordingOutcome.ts` の `void addPendingPage` と `void recordSkipReason` のfire-and-forgetがない
- [x] 案Aまたは案Bのどちらかに統一し、呼び出し側がsettled状態を扱う
- [x] 登録失敗時にunhandled rejectionが発生しない
- [x] 登録失敗の事実が `addLog` で追跡できる
- [x] 正常系の `RecordingResult` と通知内容が変わらない
- [x] 型チェックが通る

## テスト戦略(t_wada式)

Outside-Inで進める。まず失敗を再現する単体テストを書き、それから実装して緑にする。

### E2Eテスト

- 対象外。振る舞い保持の修正のため、既存の記録フローを壊さないことを優先する。

### 統合テスト

- 既存のpipelineテストで回帰確認する。対象は `recordingPipeline` 系と `orchestrator` 系と `savePhase` 系である。

### 単体テスト

- `addPendingPage` がrejectしたときにunhandled rejectionにならずログが残るテスト
- `recordSkipReason` がrejectしたときに落ちずにログが残るテスト
- 正常系で結果と通知が変わらないテスト
- `settlePending` のようなwrapperを作った場合、その成否分岐の境界値テスト

### 型チェック

- `npm run type-check` が通ること

## 見積もり

- 2SP

## 技術的考慮事項

- 依存関係: なし
- テスタビリティ: `OutcomePendingWriter` と `OutcomeSkipRecorder` は注入可能なのでin-memory fakeで失敗を再現できる
- 非機能要件: Service Worker停止時の耐久性は既存の `flushLogs` 契約を壊さないこと
- 実装方針: 案Aと案Bは二者択一である。両方を混在させないこと

## 実装者向け注記

### 現状コードの確認

着手前に必ず次を実行すること。

```bash
grep -rn "void addPendingPage\|void recordSkipReason" src/background/pipeline/
grep -rn "flushLogs" src/background/pipeline/RecordingOrchestrator.ts
grep -rn "StepDelayFn\|enqueueError" src/background/pipeline/stepExecutor.ts
```

### 実装手順

1. 失敗再現の単体テストを書く(`addPendingPage` と `recordSkipReason` のreject時)
2. 案Aまたは案Bを選んで実装する(迷ったら案Bのwrapper集約を優先)
3. 失敗時の `addLog` 出力をassertする
4. 既存のpipelineテストと `npm run type-check` で回帰確認する

### 落とし穴

- `void` を消して `await` するだけでは呼び出し側の型とテストfakeの両方を直す必要がある
- ログにURLやtitleや本文を入れないこと。失敗の事実とtraceIdにとどめること
- 本PBIの対象外である `saveLocalMarkdownStep.ts` と `webhookExportStep.ts` には手を出さないこと

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存のpipelineテストがパスする
- [x] `npm run type-check` がパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
