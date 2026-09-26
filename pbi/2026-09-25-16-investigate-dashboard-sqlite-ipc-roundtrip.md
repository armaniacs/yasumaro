# PBI: ダッシュボード SQLite 取得の IPC 往復削減

## ユーザーストーリー

ダッシュボードを開いたときの初期描画が遅いユーザーとして、ページ送りを伴うパネルのデータ取得で、直列化される `getSqliteStatus()` と `queryLogs()` の重複往復を削減したい。最大 5 ページを送る `domainAnalysisPanel` では、status 5 回と query 5 回で最大 10 往復が発生し得るため、実害を計測して適切な方式を選定する。

## ビジネス価値

ダッシュボード初期描画の待ち時間を減らし、ページ数の多いパネルで IPC 往復が直列化される問題を、実測値に基づいて改善する。採用方式を実装前後のダッシュボードから Service Worker への messaging 回数と経過時間で比較する。採用方式が `refactor` を必要としない場合は、現行方式を維持する判断根拠まで明確にする。

## 優先度

- 順位: 16 / 30
- RICEスコア: 1.33（Reach=8 / Impact=0.5 / Confidence=50% / Effort=1.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 初期描画の IPC 往復を計測する
  Given fetchPeriodRows を使う 7 パネルがあり、domainAnalysisPanel は最大 5 ページを送る
  When ダッシュボードを開き、initialized と uninitialized の状態でページ送りを含む取得を実行する
  Then 現状の status と query の messaging 回数を個別に記録できる
  And 最大 5 ページでは status 5 回と query 5 回が、最大 10 往復になることを再現できる
  And ダッシュボードから Service Worker への messaging 回数と経過時間を比較できる

Scenario: 3 方式を同じ測定条件で比較する
  Given 初期描画のベースライン計測が揃っている
  When readiness preflight 廃止、readiness-only TTL キャッシュ、query response への status 同梱を比較する
  Then 各方式の messaging 回数と経過時間が同じ条件で記録される
  And uninitialized 時の query 抑止と retry の扱いが各方式で明示される
  And version skew、Service Worker から Offscreen への往復、diagnostics の現在時刻表示への影響が評価される
  And 計測結果に基づいて採用方式が 1 つ選定される

Scenario: readiness-only TTL キャッシュを採用した場合
  Given fetchPeriodRows の取得境界に readiness-only TTL キャッシュがある
  When restore、import、または migration が発生した直後にパネルが readiness を取得する
  Then invalidate 前の status は再利用されない
  And diagnostics は現在時刻の status を取得するため、TTL キャッシュを共有しない

Scenario: query response への status 同梱を採用した場合
  Given query success response に initialized を含める message contract がある
  When dashboard、Service Worker、または開いている options page のバージョンが異なる
  Then 全サービスの再起動を前提として同じ contract を利用できる
  And sendMessage の同期的な listener return value には依存しない
```

## 受け入れ基準

- [ ] `fetchPeriodRows` を使う 7 パネルの production call site と 7 consumer の lifecycle test が対象範囲として確認されている。
- [ ] ページ数 1 と最大 5 の条件で、現行の status と query の messaging 回数および経過時間を記録できる。
- [ ] 最大 5 ページで status 5 回と query 5 回、最大 10 往復になることを再現できる。
- [ ] initialized と uninitialized の両方で、現行の messaging 回数と経過時間を比較できる。
- [ ] readiness preflight 廃止、readiness-only TTL キャッシュ、query response への status 同梱を同一条件で比較できる。
- [ ] 各方式について、dashboard→Service Worker の往復、Service Worker→Offscreen の往復、uninitialized 時の query と retry、message contract の互換性、diagnostics の現在時刻表示を評価する。
- [ ] 採用方式で uninitialized 時の query 抑止と外側 retry の扱いを明記する。
- [ ] 採用方式の判断根拠と、`refactor` の要否を明記する。
- [ ] TTL キャッシュを採用する場合、restore、import、migration 後の invalidate policy と、diagnostics が TTL を共有しないことを明記する。
- [ ] response を変更する場合、dashboard、Service Worker、開いている options page の全サービスを再起動する前提を明記する。
- [ ] message contract を変更する場合、dashboard の query consumer と Service Worker 側の response subtype を一致させる。
- [ ] 方式変更によって現行 mock 形状を維持できなくなる lifecycle test だけが必要範囲で更新される。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- ダッシュボードを開き、ページ送りを伴うパネルが initialized 状態で描画される経路を確認する。
- `domainAnalysisPanel` の最大 5 ページで、現行の status 5 回と query 5 回の messaging を再現する。
- uninitialized 状態から初期化完了までの外側 retry 経路で、採用方式の query 実行条件を検証する。
- 採用方式の messaging 回数と経過時間を、ベースラインと同じ条件で比較する。

### 統合テスト

- `getSqliteStatus()` と `queryLogs()` が別 message である現行 contract を固定する。
- readiness-only TTL キャッシュを採用する場合、`fetchPeriodRows` の取得と restore、import、migration 後の invalidate を確認する。
- query response への status 同梱を採用する場合、Service Worker が返す initialized、rows、total を dashboard の全 query consumer が解釈できることを確認する。
- `dashboardSqliteService` の status/query message、response subtype、開いている options page をまたぐ互換性を確認する。
- diagnostics が現在時刻の status を必要とするため、`fetchPeriodRows` の TTL キャッシュから独立していることを確認する。
- response を変更する場合、`sendMessage` の callback または Promise 解決で contract を受け取れることを確認する。

### 単体テスト

- 採用方式ごとの dashboard→Service Worker messaging 回数を数える。
- uninitialized 状態の query 実行条件と外側 retry の継続条件を検証する。
- readiness-only TTL キャッシュの有効期間、共有範囲、invalidate 後の再取得を検証する。
- status 同梱 response の initialized 境界値を検証する。
- `chrome.runtime.sendMessage` の同期的な listener return value へ依存しないことを検証する。

## 実装アプローチ

1. Outside-In で、まずダッシュボード初期描画と最大 5 ページ送りで、現行の messaging 回数と経過時間を再現する。
2. 3 方式を同じ initialized 状態、同じページ数、同じ messaging seam で比較する。
3. uninitialized 時の query と retry、Service Worker→Offscreen の往復、version skew、diagnostics の現在時刻表示を評価軸に含める。
4. 計測結果から方式を 1 つだけ選定し、判定基準と不採用の根拠を記録する。
5. 採用方式が現行構造で成立する場合は `refactor` を実施しない。必要な場合だけ、message contract または `fetchPeriodRows` の取得境界を最小変更する。
6. 実装が必要な場合は統合テストを先にRedにし、採用方式と既存 consumer を実装してGreenにする。その後、影響する lifecycle test の mock 形状と重複処理だけを整理する。

## 見積もり

- 1.5 SP
- 計測、3 方式の比較、方式決定、必要時の最小 `refactor` とテスト更新を含む。

## 技術的考慮事項

- `chrome.runtime.sendMessage` は callback または Promise で解決するため、`onMessage` listener の同期的な return value を前提にした設計は禁止する。
- `DashboardGateway` は document 単位に message を直列化するため、status と query の 2 回は独立した並行処理ではなく順序待ちになる。
- Service Worker 内で `getStatus()` と `query()` を順に呼んでも、dashboard→Service Worker は 1 往復になるが、Service Worker→Offscreen は 2 往復である。全体を 1 往復にするには、response への status 同梱か preflight 廃止が必要である。
- readiness-only TTL キャッシュは `fetchPeriodRows` の取得だけを対象に限定し、diagnostics の現在時刻表示へ適用しない。
- restore、import、migration 後は TTL キャッシュを invalidate する。
- query success response の現行構造は `rows` と `total` のみで、initialized を持たない。status は別 response subtype であるため、統合する場合は message contract の変更になる。
- response を変更する場合は、dashboard、Service Worker、開いている options page の version skew を避けるため、全サービスの再起動を前提とする。
- 直接の依存関係はなく、関連する既存作業と直接衝突しない。response 変更は message contract 更新の作業帯であり、transport replay safety の作業から分離する。

## 実装者向け注記

### 現状コードの確認

調査で次の事実が確認済みである。

- `src/dashboard/panels/fetchPeriodRows.ts:46-60` は、成功時と retry のたびに `getSqliteStatus()` を実行してから `queryLogs()` を実行する。
- status と query は別 dashboard→Service Worker message であり、`src/dashboard/dashboardSqliteService.ts:161-170` と `src/dashboard/dashboardSqliteService.ts:264-283` に各 request が定義されている。
- `src/messaging/dashboardGateway.ts:27-36` は document 単位に message を直列化する。
- `fetchPeriodRows` を使うパネルは 7 で、production call site も 7 である。
  - `wordClusterPanel.ts:87`
  - `tagClusterPanel.ts:87`
  - `tagClusterTimeSliderPanel.ts:137`
  - `tagCooccurrenceTablePanel.ts:218`
  - `domainAnalysisPanel.ts:273`
  - `timeHeatmapPanel.ts:84`
  - `tagFrequencyTimelinePanel.ts:391`
- `getSqliteStatus()` を実際に呼ぶ production module は 4 call site である。
  - `fetchPeriodRows.ts:48`
  - `src/dashboard/panels/diagnostic/DiagnosticsCollector.ts:89-92`
  - `diagnosticsActions.ts:199`
  - `src/dashboard/panels/asyncData/sqliteHistoryModel.ts:527-530`
- `src/utils/computeLimits.ts:57-60` により、`domainAnalysisPanel` は最大 5 ページを送る。
- `src/background/handlers/dashboardSqliteProtocol.ts:121-126` の query success response は `rows` と `total` のみを持ち、`:133-151` の status は別 response subtype である。
- `src/dashboard/panels/__tests__/fetchPeriodRows.test.ts:42-49` は通常の status→query 経路、`:61-70` は uninitialized 時に status 4 回、query 0 回となる経路を固定する。
- `src/dashboard/__tests__/dashboardSqliteService-extra.test.ts` と `sqliteHistoryModel.navigate.test.ts` が存在する。
- 8 consumer の lifecycle test があり、`wordClusterPanel.test.ts`、`tagClusterPanel.periodFilter.test.ts`、`domainAnalysisPanel.lifecycle.test.ts`、`timeHeatmapPanel.lifecycle.test.ts` は現行 mock 形状を固定している。

### 実装手順

1. 現状の status/query messaging 回数を数える観測点を用意する。
2. ページ数 1 と最大 5、initialized と uninitialized の条件でベースラインを記録する。
3. readiness preflight 廃止、readiness-only TTL キャッシュ、query response への status 同梱を同じ条件で計測する。
4. messaging 回数、経過時間、uninitialized 時の query と retry、Service Worker→Offscreen の往復、互換性、diagnostics の現在時刻表示で採用方式を決める。
5. `refactor` が必要な場合だけ、採用方式に対応する最小変更を行う。
6. query response を変更する場合、dashboard、Service Worker、開いている options page の全サービスを再起動する運用を前提として、テストと consumer を更新する。
7. 8 つの lifecycle test に影響する mock 形状だけを必要範囲で更新する。
8. `refactor` が不要だった場合も、計測結果と現行方式を維持する根拠を記録する。

### 落とし穴

- 8 consumer の lifecycle test は status と query の 2 呼び出しを固定しているため、message 形状を変更すると 8 テストの更新が必要になる。
- readiness-only TTL キャッシュを diagnostics にも適用すると、現在時刻の status 表示が古い値になる。
- restore、import、migration 後に TTL を invalidate しないと、破棄済みまたは移行済み SQLite の readiness を誤って再利用する。
- Service Worker 内で status と query を直列結合するだけでは、Service Worker→Offscreen の 2 往復は削減できない。
- query success response は現状 initialized を持たないため、status 同梱は単純な response field 追加ではなく message contract 更新になる。
- `onMessage` listener の同期的な return value を前提にすると、`chrome.runtime.sendMessage` の callback または Promise 解決と一致しない。

## 決定事項

1. **なぜ 2 往復なのか。** query 前の readiness preflight があるため、`getSqliteStatus()` と `queryLogs()` が別 message として直列化される。
2. **preflight の価値は何か。** uninitialized 時の query を避け、外側 retry で初期化を待つ意図を持つ。preflight 廃止、TTL キャッシュ、status 同梱のいずれを採用しても、この意図をどう満たすかを比較する。
3. **なぜ status が共有されないのか。** status は dashboard service の state であり、`fetchPeriodRows` の取得境界にある cache ではない。TTL を採用する場合も、readiness-only の責務を明示する必要がある。
4. **なぜ response が統合されないのか。** query と status は別 subtype、別 response contract として設計されている。統合には query success response への initialized 追加と、dashboard、Service Worker、開いている options page の再起動を伴う互換性コストがある。
5. **なぜ測定と選定が残ったのか。** 7 パネルの fetch 共通化は対象だが、IPC 総数は対象外だった。ダッシュボード初期描画、最大 5 ページ送り、initialized/uninitialized の条件で messaging 回数と経過時間を計測し、その結果で方式を決める。
6. **最終方式と `refactor` の要否。** 本 PBI 作成時点では方式を固定しない。計測結果に基づいて 1 つだけ採用方式と `refactor` の要否を決定する。

## Definition of Done

- [ ] ページ数 1 と最大 5、initialized と uninitialized の条件で、ベースラインの messaging 回数と経過時間が記録されている。
- [ ] 最大 5 ページで status 5 回と query 5 回、最大 10 往復になることを再現できる。
- [ ] 3 方式が同じ測定条件で比較され、各方式の長所、制約、採用・不採用の根拠が記録されている。
- [ ] 採用方式と `refactor` の要否が、計測結果に基づいて明記されている。
- [ ] 採用方式で uninitialized 時の query 抑止と外側 retry の扱いが明記され、テストで示されている。
- [ ] TTL キャッシュを採用した場合、restore、import、migration 後の invalidate と、diagnostics の非共有がテストで示されている。
- [ ] response を変更した場合、dashboard、Service Worker、開いている options page の全サービスを再起動する前提と message contract が明記され、全 consumer が一致している。
- [ ] 既存の `fetchPeriodRows` テストと `dashboardSqliteService-extra.test.ts` の期待結果が変わった箇所だけが更新されている。
- [ ] 方式変更の影響を受ける lifecycle test の mock 形状が必要範囲で更新され、8 consumer の描画経路が維持されている。
- [ ] BDD受け入れシナリオと、採用方式に対応する E2E、統合、単体テストが通っている。
- [ ] `refactor` が不要と判定された場合は、現行方式を維持する根拠と contract 未変更の判断が明記されている。
