# PBI: AI プロバイダの跨リクエスト circuit breaker

種別: investigate

## ユーザーストーリー

障害した AI プロバイダへ無駄な課金リクエストを送り続けるユーザーと、その Recover 費用を負担する話者として、要約生成の fallback が別リクエストをまたいでも障害中のスロットを再試行しない policy を確定したい。provider と model の組合せ単位に circuit breaker を置き、どの失敗を連続失敗として数え、いつ試行を再開するかを裁定してほしい。

## ビジネス価値

- 要約生成の 1 回の理論上の wire request 上限 40 回に対し、障害継続中は連続失敗したスロットを試行対象から外し、無駄な課金呼び出しを減らす。
- 記録をまたいで provider の状態を保持し、Service Worker のライフサイクルに左右されない判定へ統一する。
- ある provider と model の障害が、他の provider と model の利用可否を壊さないようにする。
- 429、5xx、timeout、network error、auth failure、手動接続試験を含む policy を実装前に明示し、後続 `fix` の見積もり精度を高める。

## 優先度

順位: 15 / 30
RICEスコア: 1.5（Reach=9 / Impact=1 / Confidence=50% / Effort=3 SP）
見積もり: 3 SP（circuit breaker 実装想定。policy 確定までは 1 SP の `investigate` に分割できる）

## BDD受け入れシナリオ

```gherkin
Scenario: 連続失敗したスロットを後続の要約生成から除外する
  Given 同一の provider と model の組合せが、裁定した threshold 回数だけ breaker failure を記録している
  And その状態が chrome.storage.session に保存されている
  When ユーザーが次の要約を生成する
  Then cooldown 中は当該スロットを試行せずに次の候補へ進む
  And 他の provider と model の試行には影響しない
  And 既存の最大10スロット、優先順位、fallback、in-flight dedupe、single-flight は維持される

Scenario: cooldown 終了後に half-open policy で再試行する
  Given ある provider と model の状態が、保存済み timestamp より前の時刻を cooldown 中とする
  When 新しい要約が別リクエストとしてその組合せを候補とする
  Then 保存済み timestamp と現在時刻の比較だけで lazy に試行可否を判定する
  And cooldown 経過後は裁定した half-open policy を適用する
  And Service Worker の setTimeout や module-global timer に依存しない

Scenario: 利用者が明示した接続試験は breaker によって省略しない
  Given ある provider と model の breaker が cooldown 中である
  When ユーザーが testConnection を明示的に実行する
  Then 選択したスロットは省略されず試行される
  And 試験結果が breaker state を更新するか、bypass だけとするかを裁定した契約が明記されている
  And 試験による成功、失敗、リセットの扱いが通常の要約 retry と区別される

Scenario: failure taxonomy を単一の判定根拠にする
  Given 依存 PBI の structured failure taxonomy が完了し、C28 の SSOT を利用できる
  When 429、5xx、timeout、network error、auth failure、success が発生する
  Then 各 class を連続失敗へ加算するか、無視するか、既存状態をリセットするかを裁定している
  And failure name、message、debug.statusCode の文字列照合へ依存しない
  And provider 単体 retry の POST timeout 1回、network 最大3回が終了した後の論理的な失敗だけを breaker 判定へ入力する

Scenario: 同時に到着した失敗と成功を競合なく反映する
  Given 複数のリクエストが同一の provider と model の breaker state を同時に読み書きする
  When failure count の増加、success による reset、cooldown 判定が競合する
  Then state update は裁定した方式で直列化される
  And 更新のの消失や古い state の上書きが発生しない
  And 直列化に失敗した場合も、既存の要約 fallback 処理を停止させない
```

## 受け入れ基準

- [ ] failure class ごとの「連続失敗に加算」「無害な error として無視」「state を reset」の判定表が作成されている。
- [ ] 429、5xx、timeout、network error、auth failure、success の各扱いが裁定され、structured failure taxonomy と C28 の SSOT へ接続されている。
- [ ] provider 単体 retry と circuit breaker の責務が分離され、POST timeout 1回、network 最大3回の既存 retry が維持されている。
- [ ] 連続失敗 threshold、cooldown 時間、success 時の reset、half-open probe 数が裁定され、各 policy の根拠と残存リスクが記録されている。
- [ ] breaker state の key は provider と model の組合せ識別子だけを持ち、API key を含まない。
- [ ] state は chrome.storage.session または裁定した `SessionStorePort` 実装へ保存し、module-global map を SSOT にしない。
- [ ] browser close で state が消える session-scoped 動作を前提とし、常設化や backup 対象への追加を行わない。
- [ ] cooldown は保存済み timestamp と現在時刻の比較による lazy evaluation であり、Service Worker の setTimeout を必要としない。
- [ ] concurrent read-modify-write の直列化方式が裁定され、failure count の更新の取りこぼし、古い success による reset、古い failure による再開を防ぐ。
- [ ] 欠落した state、malformed な state、taxonomy から判定できない error の扱いを含む policy が明記されている。
- [ ] 要約生成で breaker failure threshold に達した provider と model は、cooldown 中に試行されず、既存 fallback は他の利用可能候補へ継続する。
- [ ] production summary consumer 2つ、委譲 1つ、接続試験 adapter 2つについて適用範囲が整理されている。
- [ ] testConnection はユーザーが明示した試験なので breaker の cooldown による skip 対象とせず、試験結果の reset 有無だけを裁定している。
- [ ] MAX_PROVIDERS の SSOT は `src/background/ai/RemoteAIService.ts:55` に維持し、別定数を追加しない。
- [ ] 最大10スロット、built-in 3件、remote repository slot 最大7件、課金対象の外部呼び出し候補最大9件という内訳を評価へ反映している。
- [ ] in-flight dedupe と single-flight の既存挙動を維持し、breaker state update を複数リクエストの重複排除に代用しない。
- [ ] 全体 hard limit は `src/utils/aiUsageTracker.ts` に委譲し、provider health policy を二重実装しない。
- [ ] origin policy は `src/background/rateLimiter.ts`、session の永続化基盤は `SessionStorePort` または buffered `SessionStore` に委譲し、責務を混同しない。
- [ ] 裁定した新規 module の登録内容を `src/background/compositionManifest.ts:75,106-107` への追加として、後続 `fix` の受け入れ基準へ含めている。
- [ ] 新しい Chrome permission、Promise.then chain、拡張子なしの ESM import を追加しない。
- [ ] 依存 PBI `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の完了を前提とし、C28 の SSOT を再利用する判断が明記されている。
- [ ] `src/background/pendingSqliteQueue.ts:76-110` は AI を再実行しないため直接スコープ外と明記されている。
- [ ] 本 PBI は policy 確定に限定し、production code を変更せず、後続 `fix` は3 SP以上として切り出されている。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は調査と仕様確定に限定するため、production 挙動を変更する E2E test は追加しない。
- 後続 `fix` では、要約を複数回発生させ、同一 provider と model の連続 failure が threshold に達した後、cooldown 中の外部呼び出しを含まないことを Outside-In で確認する。
- 後続 `fix` では、障害中のスロットが除外されても、既存 fallback が他の候補から成功し得ることを確認する。
- 後続 `fix` では、利用者が明示的に testConnection を実行した際、cooldown 中の選択先も省略されず接続試験されることを確認する。
- 後続 `fix` では、初回要約、in-flight dedupe、single-flight、複数の production consumer 経由の要約が、裁定済み policy を一貫して適用することを確認する。

### 統合テスト

- `src/background/ai/__tests__/RemoteAIService.test.ts` を最大10スロット、優先順位、fallback、in-flight dedupe、single-flight の既存契約として維持し、breaker state をまたいでも優先順位が変わらないことを確認する。
- `RemoteAIServiceSlotLog.test.ts` を確認し、skip、trial、reset、half-open の観測方法と既存 log 契約の整合性を裁定する。
- `src/background/ai/providers/__tests__/providerParity.test.ts:308-339` と `src/background/ai/providers/__tests__/httpSummaryFlow.test.ts:124-172` を確認し、provider 単体 retry が circuit breaker failure の一件へ集約されることを確認する。
- `src/background/__tests__/rateLimiter.test.ts:206-249` と `src/background/__tests__/sqliteAlert-session.test.ts:91-132` を session state の既存根拠として確認し、採用する storage seam の testability を比較する。
- service instance 間の state 継続、session の再読込、cooldown 前後の lazy 判定、testConnection の bypass、裁定された reset を一つの統合シナリオとして確認する。
- 複数のリクエストによる同一 provider と model への同時 update を制御し、直列化後に更新の取りこぼしがないことを確認する。
- structured failure taxonomy から裁定済み breaker failure へ変換できること、message や debug.statusCode の直接判定へ依存しないことを確認する。
- aiUsageTracker の全体 hard limit、rateLimiter の origin policy、FallbackAIService の委譲が変更されないことを回帰確認する。
- compositionManifest から裁定した新規 module が wiring されることを確認する。

### 単体テスト

- provider と model の組合せ key の生成、同一組合せの安定性、異なる組合せの分離、API key の非包含を確認する。
- 裁定した threshold の直前、ちょうど threshold、threshold 超過を確認する。
- 裁定した cooldown の直前、境界時刻、cooldown 経過後を、保存済み timestamp との比較で確認する。
- 裁定した half-open、success reset、breaker failure 以外の error、breaker failure の state 遷移を確認する。
- 欠落した state、malformed な state、判定できない failure、provider 単体 retry 終了後の論理的な error を裁定どおり処理することを確認する。
- 同一 state への concurrent update を裁定した方式で直列化し、古い success、古い failure、cooldown state による上書きの消失がないことを確認する。
- testConnection が cooldown による skip を受けず、試験結果の state 扱いを裁定どおり適用することを確認する。
- lazy evaluation のみを使用し、setTimeout を生成しないことを fake clock で確認する。
- `debug.statusCode` を保持する既存 provider を壊さず、breaker 判定が structured failure class を入力に受け取ることを確認する。

## 実装アプローチ

1. 依存 PBI の structured failure taxonomy を完了条件にし、C28 の SSOT から breaker failure へ変換できる contract を確認する。
2. 最大10スロット、built-in 3件、remote 7件、外部候補最大9件、provider 単体 retry 最大4回の関係を調査台帳へ整理する。
3. 5 Whys を順に実施し、無条件な試行、health state の不在、責務配置の欠落、failure 分類の消失、policy parameter の未確定を裁定結果へつなげる。
4. failure class matrix を作り、429、5xx、timeout、network error、auth failure、success を加算、無視、reset のいずれかへ割り当てる。
5. threshold、cooldown、half-open probe、success reset、陈腐した state の扱い、testConnection の bypass および reset rule を数値と根拠付きで裁定する。
6. provider と model の key、session-scoped state shape、read-modify-write の直列化方式、module 再生成時の state 取得を設計する。
7. 既存の `SessionStorePort`、buffered `SessionStore`、`sqliteAlert.ts` の直接 read および write および module rehydrate を、責務、testability、concurrency から比較する。
8. RemoteAIService の要約 loop と接続試験 loop へ適用範囲を割り付ける。要約では breaker を試し、明示的な testConnection は skip せず、試験結果の状態反映を裁定どおりに扱う。
9. 最大10スロット、built-in と remote の数、外部候補最大9件、既存 retry、in-flight dedupe、single-flight、usage quota への非干渉を後続 `fix` の契約へ変換する。
10. 裁定結果を3 SP以上の後続 `fix` に分解し、新規 module、compositionManifest 登録、test seam、BDD test、切替条件を指定する。

## 見積もり

失敗を刻む  
休息の刻を待ち  
呼び出しを省く

## 技術的考慮事項

- 要約 loop は最大10スロットを無条件に試す。network error は provider 1件ごとに理論上4回の HTTP 試行になるため、1 summary call あたり最大40 wire requests へ増幅し得る。
- 内訳は loop 上限10、built-in 3件、remote repository slot 最大7件、課金対象の外部呼び出し候補最大9件である。breaker 導入後もこの構造を二重定義しない。
- `ProviderStrategy` の既存 retry は POST timeout 1回、network 最大3回であり、`debug.statusCode` を保持する。circuit breaker は論理的な失敗を扱い、transport retry の再設計を同時に行わない。
- production summary consumer は privacyPipeline と reviewSummaryGenerator の2つで、FallbackAIService の委譲は1つである。接続試験 adapter は MessageRouter に2つある。
- RemoteAIService の同一入力、platform、URL に対する in-flight dedupe と single-flight は、summary retry と circuit breaker state update の双方で維持する。
- state の key と value に API key を入れず、log、exception、debug output にも認証情報を出さない。
- chrome.storage.session は Service Worker の lifecycle をまたぐが、browser close では消える。durable health store にはしない。
- cooldown は保存済み timestamp を現在時刻と比較する lazy evaluation とする。Service Worker が終了するため、setTimeout による解除に依存しない。
- concurrent request に対する state の read-modify-write は直列化が必須である。read 後に無条件 write する実装は更新の取りこぼしを生む。
- `SessionStorePort` と buffered `SessionStore` は永続化基盤であり、provider health policy の責務そのものではない。採用時に provider health の責務所在を明示する。
- `src/background/sqliteAlert.ts` の直接 session read、write、module rehydrate も並存例だが、breaker に同じ方式を必須化する理由とはしない。
- `src/background/rateLimiter.ts` は origin policy、`src/utils/aiUsageTracker.ts` は全体 quota であり、provider health を既存の limiter 設定として二重実装しない。
- failure taxonomy の境界で status、name、cause が失われ、message 依存が残るため、structured failure の SSOT を境界を越えて変換し、C28 の source へ接続する。
- `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` が完了するまで、429、5xx、timeout、auth failure を breaker failure として採用するかを確定しない。
- 新しい Chrome permission は不要である。async および await のみを使い、ESM import には `.js` 拡張子を付ける。
- MAX_PROVIDERS の SSOT は `src/background/ai/RemoteAIService.ts:55` に維持し、policy module に別の最大値を定義しない。
- 新規 module を追加する場合、`src/background/compositionManifest.ts:75,106-107` の登録を後続 `fix` の完了条件にする。
- pendingSqliteQueue は AI を再実行せず SQLite insert だけを再送するため、本 PBI の直接スコープ外とする。

## 実装者向け注記

### 現状コードの確認

- `src/background/ai/RemoteAIService.ts:55` に `MAX_PROVIDERS = 10` がある。
- `src/background/ai/RemoteAIService.ts:96-99` に同一入力、platform、URL の in-flight dedupe がある。
- `src/background/ai/RemoteAIService.ts:152-186` が要約生成時の fallback loop、`src/background/ai/RemoteAIService.ts:211-246` が接続検証時の同型 loop である。
- `src/background/ai/RemoteAIService.ts:300-307` に single-flight がある。
- `src/background/ai/providers/ProviderStrategy.ts:299-308,535-565` に POST timeout 1回、network 最大3回の provider 単体 retry がある。
- `src/background/ai/providers/ProviderStrategy.ts:24-47` は `debug.statusCode` を保持する。
- `src/utils/aiUsageTracker.ts:24-41,305-375` に全体利用量の hard limit がある。
- loop 内訳は最大10件、built-in 3件、remote repository slot 最大7件、課金対象の外部呼び出し候補最大9件である。
- production summary consumer は `src/background/privacyPipeline.ts:153-166` と `src/background/reviewSummaryGenerator.ts:313-326` の2つである。
- `FallbackAIService.ts:52-60` の委譲は1つである。
- 接続試験 adapter は `src/background/handlers/MessageRouter.ts:175,178` の2つである。
- `src/background/sessionStore.ts:19-23,65-119` に汎用 `SessionStorePort` と buffered `SessionStore` がある。
- `src/background/sqliteAlert.ts:54-89` に直接 read、write、module rehydrate がある。
- `src/background/rateLimiter.ts:126-133` に `flushImmediately` の実例がある。
- `src/background/ai/__tests__/RemoteAIService.test.ts` は最大10スロット、優先順位、fallback、in-flight dedupe を扱う。
- `RemoteAIServiceSlotLog.test.ts` と `src/background/ai/providers/__tests__/providerParity.test.ts:308-339` がある。
- `src/background/ai/providers/__tests__/httpSummaryFlow.test.ts:124-172` がある。
- `src/background/__tests__/rateLimiter.test.ts:206-249` と `src/background/__tests__/sqliteAlert-session.test.ts:91-132` に session store の既存 test 根拠がある。ただし breaker で `SessionStore` 抽象を採用することは固定されていない。
- `src/background/compositionManifest.ts:75,106-107` に新規 module の登録先がある。
- `src/background/pendingSqliteQueue.ts:76-110` は AI を再実行せず SQLite insert だけを再送する。
- `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` が failure taxonomy の前提であり、完了後は C28 の SSOT を再利用できる。

### 実装手順

1. 依存 PBI の完了と C28 の failure class 境界を確認し、breaker policy の入力を確定する。
2. 最大10件、built-in 3件、remote 7件、外部候補最大9件、provider 単体 retry 最大4回の関係を表へ固定する。
3. failure class ごとに加算、無視、reset の候補と、429、5xx、timeout、network error、auth failure の扱いを比較する。
4. threshold、cooldown、half-open probe、success reset、陈腐した state の扱いを独立した decision として裁定し、根拠と残存リスクを記録する。
5. provider と model の key shape、storage value、欠落および malformed state の扱い、browser close 時の消去を定義する。
6. `SessionStorePort`、buffered `SessionStore`、直接 session adapter を concurrency、rehydrate、testability から比較し、採用方式を一つに決める。
7. concurrent update の直列化を API contract と失敗時の fallback まで定義する。state update に失敗した場合、要約 fallback 全体を停止させない。
8. RemoteAIService の要約 loop に lazy な試行可否判定、論理的な失敗記録、成功記録を接続し、MAX_PROVIDERS の SSOT は変更しない。
9. testConnection には skip しない契約と、試験結果を state に反映するまたは反映しないの裁定を接続する。
10. compositionManifest への登録、既存 dedupe、single-flight、usage quota、origin limiter への非干渉を後続 `fix` の BDD と test へ落とす。
11. 調査結果を3 SP以上の後続 `fix` に分解し、本 PBI では production 変更を行わないことを完了条件へ含める。

### 落とし穴

- 10スロットの loop 上限だけを減らし、provider 単体 retry の4倍増幅を無視すると、外部へ送る wire request の削減を正しく評価できない。
- breaker を module-global Map に置くと、Service Worker の再生成で health state を失う。module-global state を SSOT にしてはならない。
- storage.session への保存だけで read-modify-write の直列化を省くと、同時の failure や success が更新の取りこぼしを起こす。
- cooldown の解除に setTimeout を使うと、Service Worker 終了後の再開に依存し、lazy storage 判定と二重化する。
- storage session は browser close で消える。durable backup へ入れることは要求されておらず、実装範囲を広げる必要がない。
- API key を key、debug log、exception message へ入れると、provider と model の識別と認証 credential を混同する。
- structured failure class の代わりに message、name、`debug.statusCode` を文字列比較すると、taxonomy PBI 完了後も境界条件が壊れる。
- transport retry 1回ごとに breaker failure を加算すると、1つの論理的な slot failure を provider 単体 retry の回数だけ重複計上する。
- auth failure を一律 retryable にすると、無効な credential のスロットを cooldown 後も試行し続ける。auth の加算、無視、reset は個別に裁定する。
- testConnection を通常の要約と同じ skip 条件へ入れると、ユーザーが明示した診断操作の結果を得られなくなる。
- testConnection が常に breaker state を更新すると、手動試験だけで cooldown や reset policy を変え得る。bypass only か結果反映かを明示する。
- `SessionStore` 抽象を既存 test だけで固定すると、buffering、`flushImmediately`、rehydrate、concurrency の必要条件を十分に比較できない。
- rateLimiter、aiUsageTracker、`SessionStore` の既存責務へ breaker の設定を通すと、origin policy、全体 quota、provider health の境界が崩れる。
- MAX_PROVIDERS を breaker module へ複製すると、loop の SSOT と上限の二重定義になる。
- compositionManifest への登録を忘れると、module を直接 import する test は成功しても、production の Service Worker wiring は成立しない。
- pendingSqliteQueue の retry と circuit breaker を同じ retry として扱うと、AI を再実行しない既存の責務へ不要な変更を加えてしまう。

## 決定事項

5 Whys を使って次を裁定する。

1. 障害中も課金が続くのは、10スロットを無条件に試すためである。provider と model 単位の trial policy、failure threshold、cooldown、success reset、half-open probe を決める。
2. 記録をまたいで failure が続くのは、provider health を Service Worker の lifecycle 外に保存していないためである。chrome.storage.session または裁定した `SessionStorePort` 実装のどちらへ state を置き、key、value、rehydrate、schema を定義する。
3. 既存の limiter で防げないのは、rateLimiter が origin policy、aiUsageTracker が全体 quota、`SessionStore` が永続化基盤であり、いずれも provider health の責務ではないためである。breaker policy の module と責務境界を決める。
4. 適切な failure class を裁定できないのは、AI および Obsidian の status、name、cause が境界で失われ、message 依存が残っているためである。依存 PBI の完了後、C28 の SSOT を変換境界として使うか、新しい failure class を追加するかを裁定する。
5. 実装前に決める必要があるのは、429、5xx、timeout、network error、auth failure の扱い、threshold、cooldown、half-open、success reset、testConnection の bypass および reset rule、concurrent state update の直列化方式である。

裁定成果物には、failure class matrix、parameter table、state key、storage 方式、concurrency contract、testConnection rule、適用 consumer、既存 retry との境界、compositionManifest 登録、3 SP以上の後続 `fix` への分割を必ず含める。

## Definition of Done

- [ ] 依存 PBI `pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` の完了条件と、C28 の SSOT 利用方針が記載されている。
- [ ] 5 Whys の全問に、確認済みの事実、裁定、根拠、残存リスクが対応づけられている。
- [ ] 429、5xx、timeout、network error、auth failure、success の breaker 扱いを表す failure class matrix が完成している。
- [ ] threshold、cooldown、half-open probe、success reset、testConnection の bypass および reset rule が裁定されている。
- [ ] state は chrome.storage.session または裁定した `SessionStorePort` 実装へ保存し、browser close で消える前提が明記されている。
- [ ] provider と model の key に API key を含まないこと、log および exception に認証情報を出さないことが明記されている。
- [ ] concurrent state update の直列化方式と、state update 失敗時の既存 fallback 継続が明記されている。
- [ ] 要約 loop、接続試験 loop、2つの production summary consumer、FallbackAIService の委譲、MessageRouter の adapter について適用範囲が整理されている。
- [ ] MAX_PROVIDERS、最大10件、built-in 3件、remote 7件、外部候補最大9件、既存 provider retry、in-flight dedupe、single-flight の維持条件が記載されている。
- [ ] rateLimiter、aiUsageTracker、`SessionStore` との責務境界が裁定され、pendingSqliteQueue が直接スコープ外である。
- [ ] 新規 module の compositionManifest 登録方針と、state store の test seam が後続 `fix` の受け入れ基準に含まれる。
- [ ] 新しい Chrome permission、module-global state、setTimeout 依存、API key の漏出を導入しない条件が明記されている。
- [ ] 裁定結果が3 SP以上の後続 `fix` の垂直 slice、BDD test、Outside-In test strategy へ変換されている。
- [ ] 本 PBI は調査と仕様確定に限定し、production code を変更していない。
