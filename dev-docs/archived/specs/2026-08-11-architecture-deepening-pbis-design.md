# アーキテクチャ深深化PBI群 設計仕様

## 文書情報

- 作成日: 2026-08-11
- 種別: 親PBI 1件 + 子PBI 5件
- 管理方式: 個別PBIファイル
- 実施順: 依存関係を厳密に反映
- 受け入れ条件: BDD
- 実装詳細: 後続の実装計画で確定

## 設計判断

本取り組みは、アーキテクチャレビューで発見された5つの深深化候補を、親PBI 1件と依存順に実施する子PBI 5件として管理する。各子PBIは独立してレビュー・テスト可能な縦切りとし、受け入れ条件とテスト観点を具体化する。一方、実装ファイルや詳細な作業手順は固定せず、後続の実装計画でコードベースの状態を確認して決定する。

実施順は次の通りとする。

```text
子PBI 1: Saved URL entry module
    ↓
子PBI 2: Unified history query module
    ↓
子PBI 3: SQLite history panelの内部seam
    ↓
子PBI 4: Recording handlerの共通interface
    ↓
子PBI 5: review summaryのAIService移行
```

問題が発生した場合は、事象の再現、直接原因の特定、なぜなぜ分析による根本原因の確認、複数解決策の比較、既存ADR・PBI・テスト契約との整合性確認、最小の安全な解決策の選択、検証結果の記録を行う。なぜなぜ分析の回数は問題の深さに応じて決めるが、根本原因が未確定の場合は20回以上継続する。

## 既存制約

- SQLiteと`chrome.storage.local`の移行中の二重書き込みを維持する。
- optimistic lock、mirror同期、retention、quota recovery、retryを維持する。
- history panelの既存表示、検索、pagination、tag filterを維持する。
- Chrome Manifest V3のService Worker lifecycleと非同期message契約を維持する。
- PII sanitization、token gate、provider設定、offscreen documentの制約を維持する。
- AIClientはprovider implementationとして残し、新規呼び出し側はAIServiceを利用する。
- 実際の複数adapterまたは明確なテストseamがない限り、新しいadapter interfaceを追加しない。
- 既存ADRに反する変更は、摩擦が実在し再検討が必要な場合だけADRを更新する。
- offscreen document lifecycleの所有権は、AI用途について未確立である（`2026-07-13-architecture-phase2-deep-dig.md`候補#3で「未解決の疑問」として持ち越され、`OffscreenManager`相当の実装は存在しない）。SQLite用途では`sqliteClient.ts`が独自にoffscreenドキュメントを管理しており、この既存所有権には触れない。子PBI5はAI用途向けの所有権を新たに確定させる作業を含み、既存制約の「維持」対象ではなく「今回決定する」対象として扱う。

## 親PBI: アーキテクチャ深深化候補5件を依存順に完了する

### ユーザーストーリー

開発者として、浅いmoduleのinterfaceに漏れている複雑性を適切なseamへ集約したい。これにより、変更のlocality、呼び出し側のleverage、interface越しのtestabilityを高めたい。

### 目的

以下の摩擦を依存順に解消する。

1. Saved URL entry moduleの低水準なstorage書き込みinterface
2. SQLiteとlegacy storageに分散したhistory query
3. SQLite history panelの内部test seam不足
4. Recording handlerの重複したdependency interface
5. review summaryの`AIClient`直接利用

### スコープ

- 子PBI 1〜5を依存順に管理する。
- 各子PBIのBDD受け入れ条件とテスト観点を満たす。
- 既存機能を維持しながらinterface、seam、adapterの責務を整理する。
- 5件完了後に全体検証を行う。

### 非スコープ

- 新機能の追加
- UIデザインの刷新
- SQLite完全移行の前倒し
- 既存ADRが明示的に保留している判断の無条件な変更
- 実装計画で必要性が確認されていないファイル分割やadapter追加

### 依存関係

各子PBIは次の順序で開始する。

1. Saved URL entry module
2. Unified history query module
3. SQLite history panelの内部seam
4. Recording handlerの共通interface
5. review summaryのAIService移行

### 完了条件

- 5つの子PBIがすべて完了している。
- 各子PBIのBDDシナリオが成功している。
- 全体のtype check、test、buildが成功している。
- 既存ADRと矛盾する変更について、必要な再検討または例外記録がある。
- 記録、履歴表示、SQLite移行、AI要約が利用できる。
- storage、handler、providerの低水準知識が呼び出し側へ新たに漏れていない。

### 全体BDDシナリオ

```gherkin
Scenario: 全ての深深化候補が依存順に完了する
  Given 親PBIと5つの子PBIが登録されている
  When 子PBIを定義された依存順に完了する
  Then 各子PBIが独立して検証可能である
  And 後続の子PBIが前段のinterfaceとseamを利用できる
  And 最終的な全体検証が成功する

Scenario: 既存の記録・履歴・AI機能が維持される
  Given 5つの深深化変更が適用されている
  When 記録、履歴表示、SQLite操作、review summaryを実行する
  Then 既存の成功フローが維持される
  And 失敗が成功や空結果へ変換されない
  And retry、sanitization、MV3 lifecycleが維持される
```

## 子PBI 1: Saved URL entry moduleを深深化する

### ユーザーストーリー

開発者として、Saved URL entry moduleの低水準なstorage知識を集約したい。これにより、記録処理がfield名、optimistic lock、mirror key、retention、retryを個別に扱わず、変更のlocalityとtestabilityを高めたい。

### スコープ

- `chrome.storage.local`へのSaved URL entry書き込みを集約する。
- metadata保存を複数の低水準書き込みから一つのドメイン操作へ整理する。
- optimistic lock、mirror同期、retention、quota recovery、retryを維持する。
- SQLite移行時に置き換え可能なseamを準備する。
- 既存のdual-write仕様を維持する。

### 非スコープ

- SQLite完全移行
- legacy dual-writeの削除
- Saved URL entry全読み取り経路の統合
- UI変更
- 新しいstorage方式の導入

### 受け入れ条件

```gherkin
Scenario: metadataを一つの操作として保存する
  Given 有効なSaved URL entryとmetadataがある
  When 記録処理がmetadata保存を実行する
  Then Saved URL entry moduleが必要なmetadataを保存する
  And 呼び出し側はfieldごとのstorage書き込みを実行しない
  And 既存の保存結果を保持する

Scenario: optimistic lockを維持する
  Given 同じSaved URL entryに並行更新が発生する
  When metadata保存を実行する
  Then optimistic lockが競合を検出する
  And 既存の競合時エラーまたはretry方針が維持される
  And 部分的なmetadataだけが成功状態として扱われない

Scenario: quota recoveryを維持する
  Given chrome.storage.localのquota超過が発生する
  When Saved URL entryの保存を実行する
  Then 既存のlegacy storage purge方針が適用される
  And retry可能な場合は既存のretry方針に従う
  And 保存失敗が成功値、空値、部分成功へ変換されない

Scenario: dual-writeを維持する
  Given legacy dual-writeが有効である
  When 記録処理が完了する
  Then SQLiteとchrome.storage.localの両方に必要な情報が保存される
  And fallback modeとlegacy history panelの挙動が変わらない

Scenario: dual-write無効化を維持する
  Given legacy dual-writeが無効である
  When 記録処理が完了する
  Then chrome.storage.localへのlegacy metadata書き込みは行われない
  And SQLiteへの保存は通常通り実行される
```

### テスト観点

- 正常系、optimistic lock競合、quota超過、purge後retry
- retry queueへの保持と再実行
- metadata対象field、dual-write有効・無効、fallback mode
- legacy history panelとduplicate checkの既存挙動
- 部分更新防止とstorage呼び出し回数
- interface越しのfake adapterまたは既存test seam

## 子PBI 2: Unified history query moduleを深深化する

### ユーザーストーリー

開発者として、履歴表示側からSQLiteとlegacy storageの構造差を隠したい。これにより、履歴の取得・enrichment・field mappingを一つのinterface越しに扱い、変更のlocalityとtestabilityを高めたい。

### スコープ

- SQLite履歴とlegacy `chrome.storage.local`情報の取得を一つのmoduleへ集約する。
- SQLite行とlegacy metadataのenrichment規則を集約する。
- snake_case / camelCase変換、分単位bucket matching、欠損値処理を集約する。
- history panelが二つのstorage schemaを直接知らない構造にする。
- SQLite adapterとlegacy storage adapterの役割を明確化する。
- 子PBI 1の保存契約と整合させる。

### 非スコープ

- SQLite schema変更
- legacy storage即時削除
- history panel全体のDOM刷新
- paginationやfilter仕様変更
- Saved URL entry書き込み処理
- 第三の保存先への対応

### 受け入れ条件

```gherkin
Scenario: SQLite履歴を取得する
  Given SQLiteに履歴行が存在する
  When history query moduleで履歴を検索する
  Then SQLite履歴が統一された履歴形式で返される
  And 呼び出し側はSQLite固有のrow schemaを知らない

Scenario: legacy metadataでenrichmentする
  Given SQLite履歴行と対応するlegacy metadataが存在する
  When history query moduleで履歴を検索する
  Then 対応するlegacy metadataが履歴へenrichmentされる
  And snake_caseとcamelCaseの差異はmodule内部で吸収される
  And 呼び出し側は二つのschemaを直接結合しない

Scenario: legacy metadataが欠損している
  Given SQLite履歴行に対応するlegacy metadataが存在しない
  When history query moduleで履歴を検索する
  Then SQLite履歴は失われずに返される
  And 欠損metadataは定義済みの空値または未設定値として扱われる
  And query全体は失敗しない

Scenario: bucket matchingが適用される
  Given SQLite履歴とlegacy metadataのtimestampが完全一致しない
  When history query moduleでenrichmentを実行する
  Then 既存の分単位bucket matching規則が適用される
  And 別の履歴へmetadataが誤って結合されない

Scenario: panelが統一interfaceだけを利用する
  Given SQLite history panelが履歴を表示する
  When panelが履歴データを読み込む
  Then panelはhistory query moduleの統一interfaceだけを呼び出す
  And SQLiteまたはlegacy storageの直接参照を行わない
  And 既存の履歴表示、検索、tag filterの結果が維持される
```

### テスト観点

- SQLite行変換、legacy enrichment、schema変換、bucket matching
- timestamp境界値、欠損metadata、duplicate URL、同一bucket内の複数履歴
- tag filter、日付範囲、pagination
- SQLite adapter障害、legacy storage adapter障害
- 両adapterのfakeを使ったinterface越しテスト
- panelからのstorage schema直接参照防止

## 子PBI 3: SQLite history panelの内部seamを深深化する

### ユーザーストーリー

開発者として、SQLite history panelのstate、query、render、formattingの判断をテスト可能な内部seamへ整理したい。これにより、外部panel interfaceを維持したまま、DOM依存を減らし、変更のlocalityとtestabilityを高めたい。

### スコープ

- state遷移を内部seamへ整理する。
- query結果から表示用データへの変換を内部seamへ整理する。
- formattingとHTML生成の純粋な判断をDOMから分離する。
- 子PBI 2のunified history query moduleを利用する。
- 外部の`AsyncDataPanel` interfaceを維持する。
- panel lifecycle、検索、pagination、tag filterの既存挙動を維持する。

### 非スコープ

- panel全体のファイル分割
- 新しいpanel abstraction
- UIデザイン変更
- history queryのstorage adapter変更
- SQLite schema変更
- 他のdashboard panelへの一括適用

### 受け入れ条件

```gherkin
Scenario: panel lifecycleを維持する
  Given SQLite history panelがdashboardへ登録されている
  When mount、loadData、onActivate、unmountが実行される
  Then 既存のlifecycle順序が維持される
  And query結果はpanelの表示へ反映される
  And unmount後にevent listenerやpending処理が残らない

Scenario: state遷移をDOMなしで検証する
  Given 初期stateのSQLite history panelがある
  When 検索、pagination、tag filterの操作を適用する
  Then state遷移が定義された規則に従う
  And stateのテストはDOM環境を必要としない
  And 不正なページ番号や空のfilterが安全に処理される

Scenario: query結果を表示用データへ変換する
  Given unified history query moduleが履歴行を返す
  When panelが表示用データを生成する
  Then field formattingと欠損値処理が既存仕様に従う
  And query結果のschemaがDOMへ直接漏れない

Scenario: 診断metadataを安全に表示する
  Given 履歴行に診断metadataまたは不正な文字列が含まれる
  When panelがdiagnostic metadataをHTMLへ変換する
  Then 既存のsanitization規則が適用される
  And HTML injectionが発生しない
  And 有効なmetadataは従来通り表示される

Scenario: query失敗をpanelへ伝える
  Given unified history query moduleが失敗結果を返す
  When panelが履歴を読み込む
  Then panelは既存のエラー表示を行う
  And 失敗を空の履歴として扱わない
  And loading stateが終了する
```

### テスト観点

- state reducer相当の内部seam、表示用変換、formatting、欠損値
- diagnostic metadata sanitizationとXSS相当入力
- query失敗、空結果、部分metadata
- pagination境界、tag filterと検索の組み合わせ
- lifecycleのlistener cleanup
- DOM統合と`AsyncDataPanel` interface越しのdashboard統合

## 子PBI 4: Recording handlerの共通interfaceを深深化する

### ユーザーストーリー

開発者として、記録系handlerに重複したdependency interfaceを持たせず、Recording moduleの必要な振る舞いだけを一つのseam越しに提供したい。これにより、composition rootの配線を局所化し、handlerのtestabilityと変更時のleverageを高めたい。

### スコープ

- `ManualRecordHandlerDeps`と`SaveRecordHandlerDeps`の重複を解消する。
- 記録系handlerが必要な振る舞いだけに依存する構造へ整理する。
- `setUrlContent`など重複したclosure配線を一箇所へ集約する。
- `MessageHandlerRegistryDeps`の依存知識を必要最小限に整理する。
- 既存のhandler registryとcomposition rootの責務を維持する。
- RecordingPipeline / RecordingLogicの既存挙動を維持する。

### 非スコープ

- handler registry全体の再設計
- RecordingPipelineの処理順序変更
- recording permissionやrate limit仕様変更
- Service Worker lifecycle変更
- AI providerやstorage adapter変更
- 全handlerを一つのinterfaceへ強制統合すること

### 受け入れ条件

```gherkin
Scenario: 手動記録handlerが必要な振る舞いだけを利用する
  Given 手動記録handlerが登録されている
  When 手動記録messageを処理する
  Then handlerは記録に必要なRecording moduleのinterfaceだけを利用する
  And RecordingLogic全体や不要なmethod群へ依存しない
  And 既存の手動記録結果が維持される

Scenario: 保存handlerが共通interfaceを利用する
  Given 保存handlerが登録されている
  When 保存messageを処理する
  Then 保存handlerは手動記録handlerと共有可能なRecording moduleのinterfaceを利用する
  And 重複したdependency interfaceを要求しない
  And 既存の保存処理とエラー応答が維持される

Scenario: composition rootの重複配線を排除する
  Given production composition rootがhandler registryを構築する
  When 記録系handlerを登録する
  Then 共通の依存closureまたはadapterは一度だけ構築される
  And handlerごとの重複配線が存在しない
  And handler固有の依存は明示的に保持される

Scenario: handler間の依存分離を維持する
  Given あるhandlerに新しい依存が追加される
  When handler registryの型を検証する
  Then 不要なhandlerのinterfaceは変更されない
  And 依存追加の影響範囲が対象handlerとcomposition rootに限定される

Scenario: fakeを使ってhandlerをテストする
  Given Recording moduleのfake interfaceがある
  When 手動記録または保存handlerをテストする
  Then 実際のRecordingLogic全体を構築せずにhandlerを検証できる
  And message入力、permission、rate limit、結果変換を確認できる
```

### テスト観点

- 手動記録handlerと保存handlerのinterface越しテスト
- 共通fakeの再利用
- 不要な依存を要求しない型構造
- composition rootのclosure重複防止
- handler固有依存の分離
- permission拒否、rate limit拒否、recording failure
- success / error response mapping
- MV3非同期message応答と`return true`
- registry構築時の既存handler登録

## 子PBI 5: review summaryをAIServiceへ移行する

### ユーザーストーリー

開発者として、review summary生成が`AIClient`を直接生成せず、既存のAIService interfaceを利用するようにしたい。これにより、provider挙動、token policy、error handlingのlocalityを高め、AI機能を同じinterface越しにテストしたい。

### スコープ

- `reviewSummaryGenerator`の`AIClient`直接生成を解消する。
- 既存の`AIService` interfaceをreview summary経路へ注入する。
- weekly summaryとmonthly summaryを対象にする。
- Service Worker、alarm、dashboardの呼び出し経路を必要な範囲で整理する。
- `AIClient`をprovider implementationとして内部に残す。
- summary出力、token計測、sanitization、error handlingを維持する。
- offscreen document lifecycleの所有権を明確にした上で移行する。

### 非スコープ

- 新しいAI providerの追加
- `AIClient` implementationの削除
- `AIService` interfaceの大規模変更
- summary promptや出力形式変更
- AI token policy変更
- offscreen document実装全体の刷新
- review summary以外の呼び出し経路再設計

### 受け入れ条件

```gherkin
Scenario: weekly summaryがAIServiceを利用する
  Given weekly summary生成が要求される
  When summaryを生成する
  Then review summary generatorはAIService interfaceを利用する
  And AIClientを直接生成しない
  And 既存のsummary内容と出力形式が維持される

Scenario: monthly summaryがAIServiceを利用する
  Given monthly summary生成が要求される
  When summaryを生成する
  Then review summary generatorはAIService interfaceを利用する
  And providerの選択と設定は既存のcomposition root方針に従う
  And 既存のsummary内容と出力形式が維持される

Scenario: provider failureを統一的に扱う
  Given AIServiceがprovider failureを返す
  When review summaryを生成する
  Then 既存のsummary error handlingが適用される
  And provider固有のimplementation詳細が呼び出し側へ漏れない
  And failureが空のsummaryや成功値へ変換されない

Scenario: offscreen lifecycleを維持する
  Given Service Workerまたはalarmからsummary生成が起動される
  When AIServiceがoffscreen documentを必要とする
  Then offscreen documentの生成、利用、終了は決定済みの所有者が管理する
  And Service Workerの再起動や終了後も不正な状態を残さない
  And 既存のMV3非同期message契約が維持される

Scenario: AIService fakeで検証する
  Given AIService fakeが注入されている
  When weeklyまたはmonthly summaryをテストする
  Then 実際のAIClientやproviderを生成せずにsummary生成を検証できる
  And 入力、prompt選択、出力変換、failure handlingを確認できる
```

### テスト観点

- weekly / monthly summaryのAIService注入
- 全呼び出し経路のcomposition
- AIService fakeによるprovider非依存テスト
- provider failure、timeout、retry
- token計測、summary sanitization
- 空入力と大量入力
- alarm起動、dashboard起動、Service Worker再起動
- offscreen document lifecycle
- AIClient直接生成の残存検出
- 既存AI provider integration tests

## ADRと既存文書の扱い

- `2026-07-07-sqlite-chrome-storage-dual-write.md`: Saved URL entryのdual-writeとlegacy storage保持を維持する。
- `2026-07-13-architecture-phase2-deep-dig.md`: Panel lifecycle、handler依存の絞り込み、offscreen lifecycle先行判断を維持する。
- `2026-07-27-ai-client-service-unification.md`: review summaryの例外を子PBI 5で再検討する。移行する場合はADRを更新し、移行しない場合は例外理由を明記する。
- 既存PBIの結果契約、Dashboard、Background composition、RecordingPipelineに関する方針と衝突する場合は、既存の結果契約・MV3 lifecycle・security制約を優先する。

## 設計承認状態

親PBIと子PBI 1〜5の設計について、ユーザー承認済み。
