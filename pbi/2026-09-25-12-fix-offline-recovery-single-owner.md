# PBI: 録画復旧経路の owner 単一化（offline ジョブと pending page の二重回収防止）

種別: fix

## ユーザーストーリー

録画処理に失敗し、自動復旧または手動復旧を必要とするユーザーとして、同一録画が offline ジョブと pending ページの両方から回収され、二重実行されない状態が欲しい。5分ごとの自動再試行とユーザーによる手動再実行のどちらが残ったとしても、有効な復旧 owner は常に1つだけとし、AI コストと Obsidian への重複追記を防ぎながら、必要な場合はユーザーが手動復旧できる代替手段を残してほしい。

## ビジネス価値

- 1度の障害で同じ録画処理と AI 呼び出しが二重に開始されることを防ぎ、AI コストの不要な倍増を避ける。
- 同一録画が Obsidian に二重追記される既知の復旧経路を排除する。
- offline ジョブが3回の再試行後に終了しても、ユーザーが pending ページから代替手段を利用できるようにする。
- 自動復旧と手動復旧のどちらが現在の owner かを明確にし、通知と pending state のライフサイクルを予測可能にする。
- 復旧 owner を Service Worker のメモリではなく永続 storage に置き、終了と再開をまたいでも排他条件を復元できるようにする。

## 優先度

順位: 12 / 30
RICEスコア: 1.6（Reach=3 / Impact=2 / Confidence=80% / Effort=3 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: offline queue への登録が成功した場合
  Given 録画処理が再試行上限へ到達し、依存 PBI の失敗種別判定により offline queue への登録対象となった
  And offline queue への登録が成功する
  When 録画処理の outcome を決定する
  Then offline ジョブが唯一の復旧 owner になる
  And 同一録画の pending ページは登録されない
  And pending ページを指すユーザー向け通知は送信されない
  And 元の recording error の伝播が維持される

Scenario: offline queue への登録が失敗した場合
  Given 録画処理が再試行上限へ到達し、依存 PBI の失敗種別判定により offline queue への登録対象となった
  And offline queue への登録が失敗する
  When 録画処理の outcome を決定する
  Then pending ページが唯一の復旧 owner になる
  And offline ジョブは作成されない
  And 同一録画についてユーザー向け通知を1回だけ送信する
  And pending ページから手動再実行を利用できる

Scenario: offline ジョブが再試行上限で終了する場合
  Given 同一録画の offline ジョブが唯一の復旧 owner である
  And そのジョブは3回の再試行をすべて終えた
  When 終端失敗としてジョブを削除する
  Then 削除後に同一録画を回収できる pending ページを1件だけ引き継ぐ
  And offline ジョブは回収可能な状態として残らない
  And pending ページを指すユーザー向け通知を1回だけ送信する
  And ユーザーは pending ページから手動再実行できる

Scenario: BEST_EFFORT の saveObsidian 失敗でも owner を単一化する
  Given BEST_EFFORT の saveObsidian が失敗し、依存 PBI の失敗種別判定により offline queue への登録対象となった
  When 録画処理の outcome を決定する
  Then 通常経路と同じ owner 裁定を適用する
  And offline queue への登録成功時は offline ジョブだけを保持する
  And offline queue への登録失敗時は pending ページだけを保持する

Scenario: pending ページから同時に手動再実行する場合
  Given pending ページが同一録画の唯一の復旧 owner である
  And 同じ URL に対する別 request が同時に手動再実行を試みる
  When 3つのユーザー入口のいずれから再実行を要求する
  Then 永続化された owner state により1件だけが実行を claim する
  And もう1件は同一録画の二重実行を開始しない
  And PerUrlMutex への依存だけでは排他を成立させない

Scenario: owner の引き継ぎ中に Service Worker が終了した場合
  Given offline ジョブから pending ページへの終端失敗の引き継ぎを永続化している
  And Service Worker が引き継ぎの途中で終了した
  When 次回起動時に復旧 state を再確認する
  Then offline ジョブと pending ページのうち一方だけが実行可能な owner として解決される
  And もう一方の未完了 owner state は回収または無効化される
  And ユーザー向け通知が重複送信されない
```

## 受け入れ基準

- [ ] `stepExecutor` から `RecordingOrchestrator` の `decideStepOutcome()` へ、offline queue への登録結果を伝える構造化結果として渡している。
- [ ] `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` で定義される失敗種別を、offline queue への登録対象判定の前提としている。
- [ ] 登録成功時は offline ジョブを唯一の owner とし、通常の `pipeline-error` pending ページを作成しない。
- [ ] 登録失敗時は pending ページを唯一の owner とし、offline ジョブを作成しない。
- [ ] 登録対象外の RETRY と FATAL は、`decideStepOutcome()` の既存方針どおり pending ページを唯一の owner とする。
- [ ] BEST_EFFORT の `saveObsidian` 失敗にも、通常経路と同じ owner 裁定を適用している。
- [ ] 終端失敗の引き継ぎは offline ジョブの削除後に代替手段を失わない順序で行い、引き継ぎ後の owner を pending ページとする。
- [ ] owner の識別子と state は `chrome.storage.local` に永続化し、Service Worker のメモリだけに依存しない。
- [ ] owner が offline ジョブの期間はそのジョブの payload に、pending ページへ引き継いだ後は pending state に保持している。
- [ ] 引き継ぎ元と引き継ぎ先で同一録画の owner 識別子を比較でき、引き継ぎ中の二重回収を永続化された claim state で防いでいる。
- [ ] `src/popup/pendingPages.ts:89-100`、`src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:394-399`、`src/background/handlers/notificationHandlers.ts:75-89` の3つのユーザー入口が同じ owner state を参照する。
- [ ] offline request の `skipDuplicateCheck: true` を owner 排他の代替として扱わず、同じ録画の手動再実行を2件同時に開始させない。
- [ ] `PerUrlMutex` を同一プロセス内直列化にだけ用い、durable mutual exclusion の根拠にしない。
- [ ] pending ページの claim 時点では直ちに削除せず、成功または明示的な破棄まで代替手段の状態を保持する。
- [ ] offline ジョブが owner の間は pending ページを指す通知を送らず、pending ページが owner になった時点で1回だけ通知する。
- [ ] 終端失敗の引き継ぎ、登録失敗、ユーザーによる手動再実行のそれぞれで二重通知を送らない。
- [ ] offline queue の50KB / 200件 / TTL 7日 / 1 cycle 20件の上限を変更していない。
- [ ] 既存の5分 retry alarm と、3回の再試行後にジョブを削除する動作を維持している。
- [ ] recovery log に API key、summary 本文、content を出力しない。
- [ ] すべての非同期処理を `async` / `await` で実装し、ESM の import に `.js` 拡張子を付けている。
- [ ] `recordingOutcome.test.ts:257-267` の「normal RETRY + offlineRetry metadata でも pending 登録」という期待値を、登録結果に応じた owner 裁定へ変更している。
- [ ] 二経路の排他を本番配線で確認する自動テストを追加している。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 再試行上限到達後に offline queue への登録が成功する経路で、offline queue processor だけが実行 owner になり、pending ページが作られないことを確認する。
- 同じ経路で登録が失敗すると、pending ページとユーザー通知が1件だけ残り、offline ジョブが作られないことを確認する。
- offline ジョブが3回再試行して終端失敗になり、pending ページへ引き継がれ、削除後に手動再実行できることを確認する。
- 3つのユーザー入口から同じ pending ページへ同時に再実行要求を出しても、実行開始が1件だけになることを本番配線で確認する。
- BEST_EFFORT の `saveObsidian` 失敗が通常経路と同じ owner 裁定になることを確認する。
- owner の引き継ぎ中に Service Worker を終了し、再起動後に同一録画の実行可能 owner が1つだけ残ることを確認する。
- 各経路で復旧通知の件数を検証し、二重通知がないことを確認する。

### 統合テスト

- `src/background/pipeline/__tests__/stepExecutor.test.ts` に登録成功・失敗を outcome へ返す統合契約を定義し、network/non-network、再試行上限到達、regenerate 抑止の既存ケースを維持する。
- `src/background/pipeline/recordingOutcome.test.ts:257-267` を変更し、登録成功時は pending なし、登録失敗時は pending ありになること、metadata だけでは pending を登録しないことを確認する。
- `src/background/__tests__/RecordingPipeline-offline-policy.test.ts:203-370` を利用し、通常 RETRY、BEST_EFFORT、失敗種別、owner 裁定の連携を確認する。
- `src/background/pipeline/savePhase.test.ts:101-105,166-193` を利用し、`saveObsidian` の BEST_EFFORT 失敗にも同じ排他規則が適用されることを確認する。
- `src/background/__tests__/offlineQueueFacadeFailure.test.ts:136-200` と `src/background/__tests__/offlineNetworkQueue.test.ts:56-106` を利用し、登録失敗、queue の永続化、既存上限を維持することを確認する。
- `src/background/__tests__/offlineQueueProcessor.test.ts` に、3回再試行後の引き継ぎ、削除後の代替手段、再開時の owner 解決を追加する。
- `src/utils/pendingStorage.ts:206-238` を中心に、pending ページ同士の URL dedupe に加えて owner 識別子による offline queue との重複防止を確認する。
- 3つのユーザー入口と pending storage を統合し、手動再実行が同じ owner state を参照することを確認する。
- 引き継ぎ中の Service Worker 再起動と通知送信の状態を組み合わせ、二重実行と二重通知がないことを確認する。

### 単体テスト

- offline queue への登録成功・失敗・登録対象外を、owner 裁定の境界で網羅する。
- 再試行上限到達、終端失敗、BEST_EFFORT、regenerate 抑止の分岐を判定表で検証する。
- offline ジョブから pending ページへの owner 引き継ぎにおける各 state 遷移と、未完了 state の解決を検証する。
- 同一 owner 識別子を持つ二重ジョブ、二重 pending、未完了の引き継ぎを排他する処理を検証する。
- owner state が `chrome.storage.local` に保存・復元され、Service Worker のメモリを再生成しても維持されることを検証する。
- pending ページの claim 時点では削除せず、成功または明示的な破棄で削除する状態を検証する。
- owner が pending ページへ確定した時だけ通知し、offline ジョブと pending ページの両方で通知しない分岐を検証する。
- recovery log に API key、summary 本文、content が現れないことを検証する。
- 既存の queue payload 上限、TTL、1 cycle の件数、5分 alarm 設定が不変であることを検証する。

## 実装アプローチ

1. 本番配線の E2E テストを先に追加し、offline queue への登録成功時と失敗時に owner が二重になる経路を再現する。
2. `stepExecutor` が登録結果を受け取れるようにし、成功・失敗を `RecordingOrchestrator` の outcome 入力へ構造化して渡す。
3. 依存 PBI `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の失敗種別を使い、offline queue への登録対象だけを offline owner として扱う。
4. `recordingOutcome.ts` の pending 登録条件に登録結果を反映し、成功時は pending を作らず、失敗時だけ pending を作る。
5. offline queue processor の終端失敗処理に、3回再試行後の pending ページへの引き継ぎとジョブ削除を実装する。
6. 同一録画の owner 識別子と claim state を `chrome.storage.local` に永続化し、引き継ぎ中の未完了状態と Service Worker 再起動に対応する。
7. 3つのユーザー入口を同じ owner state と claim 処理へ接続し、`skipDuplicateCheck: true` と `PerUrlMutex` に依存しない重複防止を確認する。
8. 通知を pending owner の確定時だけ1回送信し、pending の削除時期と終端失敗後の代替手段の保持を統合テストで固定する。
9. 既存の stepExecutor、recordingOutcome、offline policy、savePhase、offline queue、processor のテスト期待値を更新する。
10. owner 裁定後、`pbi/2026-09-25-13-investigate-obsidian-write-replay-idempotency.md` が本 PBI を前提に着手できることを確認する。

## 見積もり

3 SP

- owner 裁定を outcome へ渡す経路と本番配線の E2E テスト: 1 SP
- 終端失敗の引き継ぎ、永続 claim、再開時の owner 解決: 1 SP
- 3つのユーザー入口、通知、pending の削除時期、既存テストと制約の確認: 1 SP

## 技術的考慮事項

- 再試行上限到達後、`src/background/pipeline/stepExecutor.ts:36-57` が offline queue へ登録し、登録の成否に関わらず元の error を `src/background/pipeline/stepExecutor.ts:89-112` で再 throw する。
- `src/background/pipeline/RecordingOrchestrator.ts:193-203` は `decideStepOutcome()` を呼び、RETRY と FATAL は `src/background/pipeline/recordingOutcome.ts:138-157` で通常の `pipeline-error` pending ページへ登録される。
- BEST_EFFORT の `saveObsidian` も同じ二経路を持ち、`src/background/pipeline/recordingOutcome.ts:176-194` で pending ページへ登録される。
- 既存の相互排除は `src/background/pipeline/stepExecutor.ts:70-80` と `src/background/pipeline/recordingOutcome.ts:123-154` の regenerate のみである。
- pending ページ同士には `src/utils/pendingStorage.ts:206-238` の URL dedupe があるが、offline queue との重複防止はない。
- 本番の呼び出し箇所は、offline queue への登録1箇所の `src/background/pipeline/stepExecutor.ts:53-55,91` と、pending ページ登録2箇所の `src/background/pipeline/recordingOutcome.ts:153,193` である。
- `offlineRetry` は3 step で宣言されるが、実到達は2 step である。owner 裁定は宣言数ではなく実際の到達経路を基準にする。
- `src/background/offlineQueueProcessor.ts:40-60` の consumer branch は、`obsidian_sync` が `retryObsidianWrite`、`ai_summary` と legacy が full `record` である。
- offline queue は `src/background/offlineNetworkQueue.ts:24-54` で `chrome.storage.local` に永続化される。owner state を Service Worker のメモリに置かない。
- retry alarm は `src/background/alarmRegistry.ts:128` の既存5分 alarm を使う。
- `src/background/offlineNetworkQueue.ts:25-33` の50KB / 200件 / TTL 7日 / 1 cycle 20件を維持する。
- `PerUrlMutex` は同一プロセス内直列化にだけ用いる。owner 識別子と claim state が永続的な排他の根拠になる。
- 登録結果は元の error を壊さず、outcome へ渡す構造化情報として運ぶ。これにより、元の error の再 throw を維持しながら owner 裁定を行える。
- active owner が offline ジョブの期間はそのジョブの payload に owner state を持ち、終端失敗の引き継ぎ後は pending state が引き継ぐ。両者は同じ owner 識別子で関連付ける。
- 引き継ぎ中、offline ジョブと pending ページの両方を実行可能にしない。永続化された claim state により、再開時に片方を回収または無効化する。
- pending owner は claim 時に直ちに削除せず、成功または明示的な破棄まで保持する。offline ジョブは pending owner の引き継ぎが永続化されてから削除する。
- 通知は pending owner が確定した時点で1回だけ送信する。offline queue への登録成功と pending ページ登録の両方で通知しない。
- API key、summary 本文、content は recovery log に出さない。
- 本 PBI が対象にするのは既知の二重回収経路の owner 排他である。Obsidian への書き込み後に Service Worker が終了した場合の再実行冪等性は `pbi/2026-09-25-13-investigate-obsidian-write-replay-idempotency.md` の対象である。
- `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` が本 PBI の前提であり、この依存を満たすまで offline queue への登録対象判定を確定しない。

## 実装者向け注記

### 現状コードの確認

- `src/background/pipeline/stepExecutor.ts:36-57,70-80,89-112` は再試行上限到達、regenerate の offline queue 登録抑止、登録後の error 再 throw を持つ。
- `src/background/pipeline/RecordingOrchestrator.ts:193-203` は error から `decideStepOutcome()` を呼び出す箇所である。
- `src/background/pipeline/recordingOutcome.ts:123-157,176-194` は通常 RETRY と BEST_EFFORT `saveObsidian` の pending ページ登録経路である。
- `src/utils/pendingStorage.ts:206-238` は pending ページ同士の URL dedupe であり、offline queue との重複防止ではない。
- `src/background/offlineNetworkQueue.ts:24-54` は queue の `chrome.storage.local` への永続化と上限を定義する。
- `src/background/offlineQueueProcessor.ts:40-60` は `obsidian_sync` と `ai_summary` / legacy の consumer branch を分ける。
- `src/background/alarmRegistry.ts:128` は5分 retry alarm を提供する。
- `src/popup/pendingPages.ts:89-100`、`src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:394-399`、`src/background/handlers/notificationHandlers.ts:75-89` は pending 復旧のユーザー入口である。
- `src/background/pipeline/__tests__/stepExecutor.test.ts` は再試行上限到達後の登録、network/non-network、regenerate 抑止を確認する。
- `src/background/pipeline/recordingOutcome.test.ts:257-267` は normal RETRY と offlineRetry metadata があっても pending を登録する期待値を明示している。
- `src/background/__tests__/RecordingPipeline-offline-policy.test.ts:203-370`、`src/background/pipeline/savePhase.test.ts:101-105,166-193`、`src/background/__tests__/offlineQueueFacadeFailure.test.ts:136-200`、`src/background/__tests__/offlineNetworkQueue.test.ts:56-106`、`src/background/__tests__/offlineQueueProcessor.test.ts` は関連経路の既存テストである。
- 二経路の排他を確認する end-to-end test は存在しない。

### 実装手順

1. 依存 PBI の失敗種別を前提に、offline queue 登録対象、pending 対象、regenerate 抑止の判定表を作る。
2. 登録成功・失敗・登録対象外を返す構造化経路の E2E テストを先に追加する。
3. `stepExecutor` から `RecordingOrchestrator` への結果伝達を実装し、元の error 再 throw を維持する。
4. `recordingOutcome.ts` で登録成功時は pending を作らず、登録失敗時だけ pending を作る。
5. `saveObsidian` の BEST_EFFORT にも同じ owner 裁定を通す。
6. offline ジョブの owner 識別子と claim state を `chrome.storage.local` に永続化する。
7. 終端失敗として3回再試行を完了した後、pending ページへ owner を引き継ぎ、永続化後に queue ジョブを削除する。
8. Service Worker の再起動時と引き継ぎ未完了 state の解決処理を追加する。
9. 3つのユーザー入口を同じ owner claim に接続し、同一録画の同時手動再実行を1件へ収める。
10. pending の削除条件と通知送信条件を1回ずつに固定する。
11. 既存テストの期待値を変更し、本番配線の E2E と統合テストで owner が常に1つであることを確認する。
12. queue 上限、5分 alarm、3回再試行、プライバシー、`async` / `await`、ESM の `.js` import 制約を確認する。

### 落とし穴

- `recordingOutcome.test.ts:257-267` は「RETRY でも pending 登録」を正として固定しているため、登録結果に応じた期待値へ必ず変更する必要がある。
- `void enqueueOfflineJob()` から結果が返らないため、成否を判定できずに offline ジョブと pending ページの二重 owner を残す。
- offline queue への登録成功後に pending を常に作ると、5分ごとの自動再試行とユーザー操作が同じ録画を順次実行する。
- pending を常に作らない設計は、offline ジョブが3回再試行後に削除された際に唯一の代替手段を失う。
- offline queue への登録失敗を登録成功と同一視すると、queue と pending の両方に復旧記録が残る。
- pending ページ同士だけの URL dedupe では、offline queue との重複を防げない。
- `PerUrlMutex` は Service Worker の再起動や別 process の排他を保証しないため、owner claim の代替にできない。
- offline request の `skipDuplicateCheck: true` により、owner state を確認しない手動入口から同一録画を二重実行できる。
- offline ジョブが owner の間に pending 通知を送ると、終端失敗後の引き継ぎ通知と合わせて二重通知になる。
- pending ページを claim 開始時に削除すると、処理途中で終了した場合に代替手段を失う。
- 引き継ぎ後に queue ジョブを残すと、5分 alarm が同じジョブを再回収する。
- 引き継ぎが未完了のまま両方の owner を実行可能にすると、再開後の二重実行を防げない。
- `offlineRetry` の宣言3 step と実到達2 step を混同すると、実経路を覆う owner 裁定にならない。
- API key、summary 本文、content を recovery log に出すと、プライバシー制約に違反する。
- owner state を追加する場合も、既存のサイズ、件数、TTL、1 cycle の件数の制限を変更しないことを明示的に確認する必要がある。

## 決定事項

5 Whys に基づく owner 裁定を次のように固定する。

1. enqueue と pending 登録が別 seam で独立に実行されるため、裁定地点は `stepExecutor` から `RecordingOrchestrator` の `decideStepOutcome()` へ続く構造化 outcome seam に置く。`stepExecutor` は登録結果を利用側へ返し、`recordingOutcome` はその結果だけを使って pending owner を作るか決める。
2. `void enqueueOfflineJob()` が結果を outcome へ返さないため、登録の成功・失敗と、依存 PBI で定義した失敗種別を構造化して返す。元の error は throw の原因として保持し、登録結果だけで重複 owner を裁定する。
3. offline ジョブは3回再試行後に削除されるため、登録成功時は offline queue を唯一の owner とし、pending を登録しない。終端失敗では、queue ジョブを削除する前に pending ページへ owner を引き継ぐ。登録に失敗した場合だけ、outcome seam が pending ページを唯一の owner にする。
4. 削除後の手動再実行と自動再実行を別々に許すと pending に owner と state がないため、同一録画の owner 識別子を永続化する。owner が offline の間は queue ジョブの payload に owner state を持ち、引き継ぎ後は pending state が引き継ぐ。引き継ぎ元と先は同じ識別子で関連付け、引き継ぎ中は永続 claim state によって同時に実行可能にしない。再開時には未完了 state を解決する。
5. ユーザーには二重通知を出さず代替手段を残すため、通知は pending owner が永続的に確定した1回だけ送信する。offline ジョブが owner の間は pending 通知を出さず、終端失敗の引き継ぎまたは登録失敗によって pending owner が確定した時点で通知する。pending ページは claim 開始時に削除せず、処理成功または明示的な破棄まで保持する。

この裁定により、通常 RETRY、BEST_EFFORT `saveObsidian`、終端失敗、手動再実行を同じ owner 規則の下で扱う。`pbi/2026-09-25-13-investigate-obsidian-write-replay-idempotency.md` は、この owner 裁定が安定した後に着手する。

## Definition of Done

- [ ] 登録の成功・失敗が outcome seam から `decideStepOutcome()` まで構造化され、元の error 伝播が維持されている。
- [ ] 登録成功時は offline ジョブのみ、登録失敗時は pending ページのみが owner になる。
- [ ] BEST_EFFORT `saveObsidian` にも同じ owner 裁定が適用されている。
- [ ] 終端失敗は queue ジョブの削除後に pending の代替手段を残し、引き継ぎ中でも二重実行が発生しない。
- [ ] owner 識別子と claim state が `chrome.storage.local` に永続化され、Service Worker 再起動後に復元できる。
- [ ] 3つのユーザー入口が同じ owner state を使い、同時手動再実行が1件だけ claim される。
- [ ] `skipDuplicateCheck: true` と `PerUrlMutex` だけに依存せず、offline queue と pending ページの重複防止が機能している。
- [ ] pending の削除時期が claim 開始時に早まらず、成功または明示的な破棄まで代替手段が保持される。
- [ ] owner 確定ごとにユーザー向け通知が1回だけで、二重通知がない。
- [ ] queue の50KB / 200件 / TTL 7日 / 1 cycle 20件、5分 alarm、3回再試行の既存制約が維持される。
- [ ] API key、summary 本文、content が recovery log に出ない。
- [ ] すべての関連 BDD シナリオが E2E、統合テスト、単体テストで自動検証され、パスする。
- [ ] `recordingOutcome.test.ts:257-267` を含む既存テストの期待値が新しい owner 裁定に合わせて更新される。
- [ ] 依存 PBI 11 と後続 PBI 13 の依存関係が実装計画に反映されている。
- [ ] `async` / `await` と ESM の `.js` import の規約が実装全体で維持されている。
