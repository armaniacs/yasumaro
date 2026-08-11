# PBI: SQLite結果契約と周辺moduleを段階的に深深化する

## ユーザーストーリー

開発者として、SQLite結果契約・Dashboard SQLite・Background composition・RecordingPipelineのoffline policyを一貫したinterfaceで扱いたい。なぜなら、障害を成功や空結果へ変換する漏れ、productionとテストの配線ドリフト、step名変更による再試行漏れを防ぎ、変更と検証を各moduleへ局所化したいから。

## ビジネス価値

これは新機能ではなく、既存の記録・検索・export・再試行を壊さずに保守性と障害時のデータ保全を高める改善である。

測定可能な価値:

- SQLiteの失敗が0件・空結果・成功として扱われない。
- SQLite結果の失敗契約がcallerごとに再解釈されない。
- Dashboard SQLiteの欠落値が暗黙の既定値へ変換されない。
- manual record、context menu、message経路が同じBackground compositionを利用する。
- offline job種別がstep名の文字列判定に依存しない。
- 各段階で関連テスト、型チェック、buildが成功する。

## スコープ

以下の5候補を一つのEpicとして扱い、依存順に実装する。

1. SqliteClientの結果契約統一
2. Dashboard SQLite handlerの結果変換重複削減
3. Dashboard SQLite responseの厳密なデコード
4. Background composition rootの統一とRecordingPipeline構築重複削減
5. RecordingPipeline offline policyのstep metadata宣言化

通知・pending登録を新しいadapterへ切り出す変更は含めない。現時点では一つのadapterしかなく、実際のseamではなく仮想的なseamに留まるためである。

## 15段階以上のwhy分析

### Why 1: なぜ5候補をまとめて修正するのか

SQLite、Dashboard、Background、RecordingPipelineの各moduleが、同じ結果契約と再試行知識を別々に解釈しているから。

### Why 2: なぜ別々に解釈しているのか

送信・受信・handler・Dashboardが、それぞれ異なるshape変換を持っているから。

### Why 3: なぜshape変換が各所にあるのか

以前の互換wrapperと段階移行用の簡易結果が恒久化しているから。

### Why 4: なぜwrapperが恒久化したのか

callerを一度に移行せず、情報を捨てる変換を安全な簡略化として扱ったから。

### Why 5: なぜ情報を捨てても問題が見えなかったのか

null、0件、失敗を区別する受け入れテストが経路ごとに揃っていなかったから。

### Why 6: なぜ受け入れテストが不足したのか

各moduleのinterfaceが実質的なtest surfaceとして定義されていなかったから。

### Why 7: なぜinterfaceがtest surfaceになっていなかったのか

送信protocolだけが型付きで、応答protocolとerror policyがcallerへ漏れていたから。

### Why 8: なぜ応答protocolがcallerへ漏れたのか

offscreen応答がルースな辞書であり、操作ごとのdecode責務が定義されていなかったから。

### Why 9: なぜdecode責務が定義されていなかったのか

送信variant、offscreen dispatch、background readerの一覧が単一の検証単位になっていなかったから。

### Why 10: なぜ一覧が単一の検証単位でなかったのか

protocolの設計が送信側中心に進み、往復契約として扱われなかったから。

### Why 11: なぜ往復契約として扱われなかったのか

Background側のcompositionが複数箇所に分散し、production経路とテスト経路が同じmoduleを通らなかったから。

### Why 12: なぜcompositionが分散したのか

service-worker.tsにlistener、dependency生成、handler登録が同居し、未使用のcreateBackgroundServicesも残ったから。

### Why 13: なぜ未使用moduleが残ったのか

構成moduleを先に作ったが、production entrypointを切り替える統合テストを先に固定しなかったから。

### Why 14: なぜ統合テストを先に固定しなかったのか

handlerとRecordingPipelineが呼び出しごとに構築され、共有されるcompositionのtest surfaceがなかったから。

### Why 15: なぜ呼び出しごとに構築されているのか

builderがsharedOfflineNetworkQueueを注入する儀式として使われ、pipelineの所有者が明確でなかったから。

### Why 16: なぜpipelineの所有者が明確でなかったのか

manual record、context menu、messageの各経路がそれぞれ依存配線を持っていたから。

### Why 17: なぜoffline policyがstep名へ結び付いたのか

step metadataにjob種別と再試行可否がなく、実行順序の情報だけでpolicyを表現していたから。

### Why 18: なぜstep metadataが不足したのか

stepの表示・識別名とoffline jobの意味が同一視され、別の概念としてモデル化されなかったから。

### Why 19: なぜ概念が同一視されたのか

step名変更や新step追加を検出するcontract testがなく、文字列比較のlocality不足が見逃されたから。

### 根本原因

複数のmoduleのinterfaceが、結果の意味・応答の検証・依存配線・offline policyという異なる知識をcallerへ漏らしている。単一の大きな変更で解決するのではなく、既存のseamを順に深くし、各段階でinterfaceをtest surfaceとして固定する必要がある。

## 実装順と依存関係

### Phase 1: SQLite結果経路を固定する

対象: Candidate 01

- `SqliteClient`のnull/boolean/`-1`結果を`CallResult<T>`へ収束する。
- `pendingSqliteQueue`、migration、purge、audit log、exportのcallerを移行する。
- 失敗理由と`retriable`を保持する。

完了条件:

- 失敗と0件を区別できる。
- 簡易結果wrapperと結果メソッド対応表が削除または内部限定化される。

### Phase 2: handlerの結果変換を局所化する

対象: Candidate 04

- `DepsResult<T>`の重複宣言を整理する。
- handlerの共通失敗写像を内部moduleへ集約する。
- token gate、許可フィールド、import batchなどcase固有のセキュリティ処理は残す。

Phase 1に依存する理由:

- 結果契約を先に固定しないと、失敗写像を二度変更するため。

### Phase 3: Dashboard SQLite responseを厳密にdecodeする

対象: Candidate 03

- `DashboardSqliteRequest` / `DashboardSqliteResponseFor`を既存のseamとして利用する。
- `getLogCount`、`appendToLogs`、`queryLogs`、`searchLogs`から厳密なdecodeを導入する。
- 欠落値、不正な数値、NaN、負数を成功や0へ変換しない。
- 既存の17公開関数は、必要性が確認できるまで維持する。

Phase 1・2に依存する理由:

- backgroundの結果shapeと失敗写像を固定してから、Dashboardの成功値decodeを整理するため。

### Phase 4: Background composition rootを統一する

対象: Candidate 02

- productionのservice-workerがcomposition moduleを利用する。
- `new SqliteClient()`とshared accessorの二重構築を解消する。
- handler登録をbuilderへ集約する。
- RecordingPipelineの構築をService Workerのcompositionへ寄せる。
- manual record、context menu、message経路が同じ依存を使うことを統合テストで固定する。

Phase 1〜3に依存する理由:

- 結果契約が安定した状態で配線を変更し、型エラーを本当の移行漏れ検出に使うため。

### Phase 5: RecordingPipeline offline policyを宣言化する

対象: Candidate 05

- step tableへretry可否とjob種別を追加する。
- `enqueueOfflineJob`のstep名文字列判定を削除する。
- step名変更後もpolicyが維持されるcontract testを追加する。
- 既存のretry回数、error strategy、queue payloadは維持する。

Phase 4に依存する理由:

- pipelineの所有者と構築経路を一つにしてから、内部のstep policyを変更するため。

## BDD受け入れシナリオ

```gherkin
Scenario: SQLite操作の失敗理由が記録経路へ届く
  Given SQLite操作がtimeoutまたはquotaで失敗する
  When recording、migration、purge、またはexportが結果を受け取る
  Then 処理は成功や0件として扱われない
  And 失敗理由と再試行可否を利用できる

Scenario: Dashboardが不正なSQLite応答を成功扱いしない
  Given SQLite応答のcountまたはappendedが欠落している
  When Dashboard SQLite moduleが応答をdecodeする
  Then 応答は失敗として扱われる
  And 0または入力件数を代替値として返さない

Scenario: Dashboard handlerが一貫した失敗結果を返す
  Given SQLite操作が構造化された失敗結果を返す
  When Dashboard handlerが応答を作成する
  Then errorとretriableが一貫して伝播する
  And handler固有のセキュリティ検証は維持される

Scenario: Backgroundの各記録経路が同じcompositionを使う
  Given background servicesが初期化済みである
  When manual record、context menu、message経路を実行する
  Then 各経路は同じrecording依存を利用する
  And 経路ごとのpipeline再構築を行わない

Scenario: Offline policyがstep名から独立している
  Given retry対象stepにoffline job種別が宣言されている
  When stepの表示名または識別名が変更される
  Then 同じretry可否とjob種別が適用される
  And 対象外stepはqueueへ追加されない

Scenario: 全操作の往復protocolが検証される
  Given backgroundがSQLite操作をoffscreenへ送信する
  When offscreenが成功、失敗、または不正な応答を返す
  Then 操作に対応した型付き結果を受け取る
  And 不正応答は成功や空結果へ変換されない
```

## 受け入れ基準

- [x] SqliteClientの対象操作が`CallResult<T>`を唯一の結果経路として利用する。
- [x] null、boolean、`-1`による失敗表現が対象callerから削除される。
- [x] timeout、quota、SQLite error、offscreen lostの失敗分類と`retriable`が保持される。
- [x] Dashboard handlerの失敗変換が一箇所へ局所化される。
- [x] Dashboard SQLiteの対象responseが操作ごとの厳密なdecodeを通る。
- [x] 欠落値、不正値、NaN、負数が成功や既定値へcoerceされない。
- [x] offscreen応答のshapeが操作ごとに検証される。
- [x] service-workerのproduction経路が単一composition rootを使用する。
- [x] manual record、context menu、message経路が同じrecording依存を利用する。
- [x] RecordingPipelineの構築が呼び出しごとに複製されない。
- [x] offline job種別とretry可否がstep metadataから決まり、step名文字列判定が削除される。
- [x] 既存の成功フロー、retry回数、queue payload、MV3制約、セキュリティ検証が維持される。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- DashboardでSQLite障害が空ファイルの成功表示にならないこと。
- Dashboardでcount取得失敗が「0件」と表示されないこと。
- 手動記録とcontext menu記録が同じ結果方針で完了すること。

### 統合テスト

Phase 1:

- recording保存失敗が失敗結果またはoffline queueになる。
- purge失敗が「0件削除」にならない。
- export失敗が空Blobとして扱われない。

Phase 2〜3:

- Dashboard handlerの全操作で失敗理由と`retriable`が維持される。
- count、append、query、searchのresponse decode契約が一致する。
- offscreen例外と不正応答が構造化された失敗になる。

Phase 4:

- service-worker起動後のmanual record、context menu、message handler経路。
- 同じ依存参照が各経路へ渡されること。
- 初期化失敗が未初期化依存の実行へ進まないこと。

Phase 5:

- `saveObsidian`相当の失敗が`obsidian_sync`になる。
- AI要約相当の失敗が`ai_summary`になる。
- 対象外stepがqueueへ入らない。
- step名変更後もjob種別が変わらない。

### 単体テスト

- `CallResult<T>`の成功、0件、timeout、quota、SQLite error、offscreen lost。
- SqliteClientの全対象操作と既存`categorizeError`境界。
- handler共通失敗写像とcase固有セキュリティ検証。
- Dashboard decoderの必須フィールド、null、文字列、NaN、負数、不正shape。
- 全送信操作と受信dispatchの網羅性。
- composition moduleの依存構築と同一参照。
- offline metadataの既定値、retry可否、job kind、全step網羅性。

### Outside-In実装順

1. 経路レベルで失敗が成功や空結果にならないテストをRedにする。
2. protocolとhandlerの統合テストをRedにする。
3. decoder、結果写像、metadataの単体テストをRedにする。
4. 実装を最小変更してGreenにする。
5. Green後にwrapper、重複、文字列リストを削除する。
6. 各Phaseの終了時に型チェックと関連テストを実行する。

## 実装アプローチ

- 各Phaseを独立した小さな変更セットとして実装する。
- Phase間では既存テスト、型チェック、必要なbuildを通過させる。
- 既存のseamを優先し、新しいadapterは実際に二つ以上のadapterが必要になるまで追加しない。
- interfaceをtest surfaceとして扱い、実装詳細を直接テストしない。
- Service Workerの状態をグローバル変数へ保持せず、MV3の非同期listener規約を維持する。
- 各Phaseでproduction経路とtest harnessの双方を同じinterfaceへ移行する。

## 見積もり

**合計 13ポイント**

- Phase 1: 3pt
- Phase 2: 1pt
- Phase 3: 3pt
- Phase 4: 3pt
- Phase 5: 2pt
- 統合検証と整理: 1pt

Epic規模のため、1スプリントで全量を完了させず、Phaseごとに垂直な完了条件を満たす。Phase 1〜3をSQLite結果契約のまとまり、Phase 4〜5をBackgroundとRecordingPipelineのまとまりとして実施する。

## 技術的考慮事項

- 依存関係: Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5。Phase 5のoffline policy自体は独立だが、構築経路の変更との混線を避けるためPhase 4後に実施する。
- 既存PBI: `2026-08-10-01`〜`05`と重複するため、本PBIは統合Epicとして扱う。実装時は既存PBIを子作業として参照し、二重実装しない。
- 既存ADR: SQLiteのStorageBackend、NoopBackend、SQL_EXEC、AIService統一、Panel lifecycleの決定を再提案しない。
- セキュリティ: token gate、sender trust、許可フィールド、response size limitを緩めない。
- MV3: offscreenからtabs、downloads、actionなどのChrome APIを呼ばない。Service Workerの遅延終了を前提にする。
- バイナリ: backup/restoreのUint8ArrayをJSON向けdecoderへ流用しない。
- 互換性: 既存のi18nキー、ユーザー向けエラーメッセージ、retry回数、queue payloadを維持する。

### 本Epicの範囲外として残す事項

- handler registryの`service-worker.ts`からcomposition rootへの移設は未実施。依存生成は`createBackgroundServices`に集約済みだが、`registry.register(TYPE, handler, trustLevel)`の26件は`service-worker.ts`に残る。移設の前提は全26件のtrust level網羅テストであり、それが無い状態での移設はcontent-script-allowedの誤付与を静的検査でもテストでも検出できない。網羅テストを先行させること。
- `obsidian_sync`のretryは`summary`と`tags`のみからMarkdownを再生成する。queue payloadの`maskedCount`はretry時に使われず、SQLite stepとmetadata stepも再実行されない。現仕様として`offlineQueueProcessor.test.ts`で固定済み。
- Dashboard SQLite statusの`opfsMigrationV2*`系フィールドは専用decoderを通さず素通しする。主要フィールド（`initialized`、`path`、`fallback`、`fts5`）は`requiredBoolean`／`requiredString`で厳密にdecodeされる。

## 実装者向け注記

### 現状コードの確認

着手前に、既存PBIと実装を再確認すること。既存の一部実装が進んでいるため、PBIをそのまま再実装しない。

```bash
grep -rn "CallResult\|insertBatch\|exportDb\|insertAuditLog" src/
grep -rn "createBackgroundServices\|createRecordingPipeline\|buildRecordingPipelineDeps" src/background/
grep -rn "Number(.*||\|String(.*||\|retriable" src/dashboard/
grep -rn "saveObsidian\|extractSentences\|privacyPipeline\|enqueueOfflineJob" src/background/pipeline/
```

確認済みの既存実装:

- 読み出し系と変更系の一部は既に`CallResult`へ移行済み。
- Dashboard SQLiteの`ServiceResult`移行は一部完了している。
- `RecordingPipeline`のstep metadataには既に`jobKind`が存在する箇所があり、文字列判定の残存範囲を特定してから変更する。
- `pbi/2026-08-10-01`〜`05`は未完了PBIとして存在するため、対象範囲を統合して更新する。

### 実装手順

1. Phase 1の対象操作とcallerを実コードで一覧化する。
2. 失敗が0件・空結果・成功へ変換されるOutside-Inテストを追加する。
3. SqliteClientとcallerを`CallResult<T>`へ移行する。
4. handlerの結果写像を共通化する。
5. Dashboard decoderを対象操作から段階導入する。
6. production compositionの統合テストを追加する。
7. service-workerの構成を単一composition rootへ切り替える。
8. RecordingPipelineの構築重複を削除する。
9. offline policyの残存文字列判定をmetadataへ移行する。
10. 各Phaseで型チェック、関連テスト、必要なbuildを実行する。

### 落とし穴

- `null`を`0`へ、欠落値を入力件数へ、失敗を空配列へ変換しない。
- `getStatus()`のように意図的にCallResult外へ置かれた契約を機械的に変更しない。
- `StorageBackend`の既存interfaceやNoopBackendのone-shot選択を再設計しない。
- `toggle_star`など成功レスポンスのshapeを壊さない。
- `DepsResult`の共通化でtoken gateやcase固有の許可フィールドを消さない。
- response decoderでbackup/restoreのバイナリを壊さない。
- Service Workerに永続状態をmodule変数で追加しない。
- compositionの共有化で別経路のライフサイクルや遅延初期化を壊さない。
- offline queueへPIIや未sanitized payloadを追加しない。
- step名とjob kindを再び同じ概念として扱わない。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装され、関連テストが成功する。
- [x] 各Phaseの受け入れ基準が確認される。
- [x] SQLiteの失敗・0件・空結果が区別される。
- [x] Dashboard response decodeが厳密で、不正応答が成功扱いされない。
- [x] productionのBackground composition rootが一つになる。
- [x] RecordingPipelineのoffline policyがstep metadataに局所化される。
- [x] `npm run type-check` が成功する。
- [x] `npm run build` が成功する。
- [x] `npm run validate` が成功する。
- [x] 既存のi18n、セキュリティ、MV3、retry、queue payloadが維持される。
- [x] 既存PBIとの重複が整理される。
- [x] Green後の重複・wrapper・文字列判定が削除される。
- [x] コードレビューが完了する。
