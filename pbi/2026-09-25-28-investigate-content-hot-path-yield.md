# PBI: コンテンツ抽出ホットパスのメインスレッド負荷の実測と最適化方式の選定

種別: investigate（計測とベースライン → 実装は別 PBI）

## ユーザーストーリー

重いページを開いたときにページの応答性が落ちるユーザーとして、同期処理のコンテンツ抽出がメインスレッドを占有しないための最適化方式を実測したい。現状の `cloneNode(true)` と TreeWalker を使うホットパスを測定し、同期最適化、非同期 rAF バッチと `scheduler.yield()`、offscreen 化の 3 方式を同じ条件で比較して、適用方式を 1 つ裁定したい。ページごとの main-thread longtask 件数と最大 duration が計測されていないため、実装に投資する前に判断基準にしたい。

## ビジネス価値

- 重いページのコンテンツ抽出で、スクロールや入力が遅くなる main-thread longtask をページ単位で可視化する。
- 3 方式の測定結果を同じ条件で比較し、推測ではなく実測に基づいて最適化方式を選定できる。
- 大量 DOM 操作に rAF batching と `scheduler.yield()` を適用するという規約と、現行の同期契約との関係を判断できる。
- 投資判断と後続の実装範囲を確定し、実装を別 PBI に渡せる。
- ページごとの longtask 件数と最大 duration を、既存の `bench:check` の deterministic micro counter と混同せずに記録できる。

## 優先度

順位: 28 / 30
RICEスコア: 0.25（Reach=1 / Impact=1 / Confidence=50% / Effort=2 SP）

## BDD受け入れシナリオ

```gherkin
Feature: コンテンツ抽出ホットパスの負荷測定と方式裁定

  Scenario: 現状の同期抽出をページ単位でベースライン化する
    Given 本番のコンテンツ抽出が contentKernel から pageContentPipeline と contentExtractor を通る
    And 抽出処理が同期の cloneNode(true) と TreeWalker を使う
    When 対象ページで現状の抽出を実行する
    Then ページごとに main-thread longtask 件数と最大 duration を記録できる
    And __benchLongTasks の duration 合計を longtask 件数として扱わない
    And 現行の bench:check がゲートする deterministic micro counter 4 種と longtask 計測を区別できる

  Scenario: 3 方式を同じ実 DOM 分布で比較する
    Given 現状の同期方式のベースラインと、同じ実 DOM 分布の測定条件が揃っている
    When 同期最適化、非同期 rAF バッチと scheduler.yield()、offscreen 化を同じ条件で計測する
    Then 各方式の longtask 件数、最大 duration、測定条件を記録する
    And 各方式の測定結果を同じ形式で比較できる
    And 結果に基づいて採用する方式を 1 つ裁定し、不採用方式の理由を記録する

  Scenario: offscreen 方式を production wiring を含めて評価する
    Given cleansing_offscreen_enabled の default は false である
    And cleanseViaOffscreen() は存在するが production call site は 0 件である
    When offscreen 化候補を評価する
    Then production wiring と設定経路の有無を判定資料に含める
    And default を true にすることだけで経路が有効になると判断しない
    And Offscreen document では chrome.runtime messaging と Web API だけを利用できる

  Scenario: scheduler 非対応環境で非同期候補の制約を満たす
    Given scheduler.yield が利用できない環境がある
    When 非同期 rAF バッチと scheduler.yield() の候補を評価する
    Then scheduler 非対応時の fallback を定義する
    And mutation generation epoch の扱いを定義する
    And ページ DOM を変更しない detached clone または text 抽出に限定する
    And ページ mutation を伴う非同期バッチは採用しない

  Scenario: longtask 件数を既存 bench check と分離する
    Given bench:check は deterministic micro counter 4 種だけをゲートする
    And bench:e2e は bench:check から分離され、JSON baseline 比較をしない
    When longtask 件数を判定へ追加する
    Then 既存 bench:check の責務を変更しない
    And longtask 件数、最大 duration、duration 合計を別々の値として記録する
    And 必要なら別の command と別の baseline を用意する
```

## 受け入れ基準

- [ ] 現状の production ホットパスとして、`src/content/contentKernel.ts:99-101`、`src/utils/contentExtractor/pageContentPipeline.ts:7-11`、`src/utils/contentExtractor/index.ts:437-441` を確認する。
- [ ] 現状の `cloneNode(true)` の production 2 箇所（`src/utils/contentExtractor/index.ts:221,276`）を測定対象として記録する。
- [ ] 対象ページごとに、現行方式の main-thread longtask 件数と最大 duration をベースラインとして記録できる。
- [ ] longtask 件数と最大 duration を、既存の `__benchLongTasks` duration 合計から区別して記録する。
- [ ] 同期最適化、非同期 rAF batching + `scheduler.yield()`、offscreen 化の 3 方式を同じ実 DOM 分布と同じ測定条件で比較する。
- [ ] 3 方式それぞれの測定結果、制約、採用・不採用の根拠を記録し、採用方式を 1 つだけ裁定する。
- [ ] offscreen 方式については、`cleansing_offscreen_enabled` の default、production call site、production wiring を含めて評価する。
- [ ] Offscreen document の利用を `chrome.runtime` messaging と Web API に限定する。
- [ ] 非同期候補では scheduler 非対応時の fallback と mutation generation epoch の要点を裁定する。
- [ ] 非同期化する場合でも、ページ DOM を変更しない detached clone または text 抽出であることを受け入れ条件にする。
- [ ] rAF batching と `scheduler.yield()` の規約を、両方とも満たす適用方式として評価する。
- [ ] longtask 件数を CI の判定対象にする場合は、既存の `bench:check` と別の command および別の baseline にする。
- [ ] 既存の `bench:check` の deterministic micro counter 4 種の責務を変更しない。
- [ ] 既存テストとして、`src/content/__tests__/contentKernel.offscreen.test.ts`、`src/utils/contentExtractor/__tests__/index.clone-dedup.test.ts`、`src/utils/contentExtractor/__tests__/bytesize-lazy.test.ts`、`bench/micro/c4.clone-dedup.bench.mjs` の対象範囲を確認する。
- [ ] `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` および `pbi/2026-09-25-14-refactor-ci-paths-filter.md` との依存・競合点を記録する。
- [ ] 本 PBI は計測と方式裁定に限定し、production の最適化実装は別 PBI にする。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は production 挙動を変更する実装ではなく、計測手順の再現と裁定記録を対象にする。
- 対象ページごとに現状のコンテンツ抽出を実行し、main-thread longtask 件数と最大 duration をベースラインとして収集する。
- 同じ実 DOM 分布と測定条件で、同期最適化、非同期 rAF batching + `scheduler.yield()`、offscreen 化を比較する。
- `bench/e2e/autosave-latency.bench.ts:154-174` と `bench/e2e/content-script-impact.bench.ts:198-218` の longtask 計測結果を、件数・最大 duration・duration 合計に分けて記録する。
- 3 方式の比較結果を同じ測定条件と形式で出力し、採用方式の裁定根拠を再現できるようにする。
- scheduler 非対応環境については、fallback を使う測定条件を非同期候補の評価に含める。

### 統合テスト

- `src/content/contentKernel.ts`、`src/utils/contentExtractor/pageContentPipeline.ts`、`src/utils/contentExtractor/index.ts` を通る production ホットパスの測定対象を確認する。
- `src/content/__tests__/contentKernel.offscreen.test.ts` を利用し、offscreen delegate の既存テスト対象を確認する。
- `src/utils/contentExtractor/__tests__/index.clone-dedup.test.ts` を利用し、`cloneNode(true)` の既存 clone dedup 測定との境界を確認する。
- `src/utils/contentExtractor/__tests__/bytesize-lazy.test.ts` と `bench/micro/c4.clone-dedup.bench.mjs` を利用し、既存の deterministic micro counter と longtask 計測を分離する。
- `bench:check` の4種 counter、`bench:e2e` の longtask 計測、件数・最大 duration・duration 合計が別々の結果として扱われることを確認する。
- longtask 件数をゲートする場合は、`bench:check` と別の command・baseline として扱えることを確認する。
- offscreen 方式を検証する場合、delegate から `chrome.runtime` messaging と Web API 以外の経路に依存しないことを確認する。
- content scheduler の `requestIdleCallback` と `setTimeout` を、DOM batching や `scheduler.yield()` の代替として扱わないことを確認する。

### 単体テスト

- longtask 計測から件数、最大 duration、duration 合計を算出するロジックを個別に検証する。
- 0 件、1 件、複数件、最大 duration の同一値、duration 合計が一致する場合など、集計上の境界を検証する。
- `scheduler.yield` が利用可能な場合と利用できない場合の分岐を検証する。
- scheduler 非対応時の fallback が、rAF batching と detach した clone または text 抽出の契約を維持することを検証する。
- mutation generation epoch の採否と、古い generation の処理の扱いを裁定資料へ反映する。
- detached clone または text 抽出がページの DOM を変更しないことを検証する。
- 既存 `bench:check` の deterministic micro counter と、新しい longtask 件数・最大 duration の command 境界を検証する。

## 実装アプローチ

1. production のコンテンツ抽出経路、既存の offscreen delegate、content scheduler、bench の longtask 計測経路を調査台帳に整理する。
2. 対象ページと実 DOM 分布、測定条件、longtask 件数と最大 duration の記録方法を固定する。
3. 現状の同期方式について、ページごとのベースラインと既存 duration 合計を記録する。
4. 同期最適化の候補を、同じ DOM 分布と同じ測定条件で計測する。
5. 非同期 rAF batching + `scheduler.yield()` の候補を計測し、scheduler 非対応時の fallback と mutation generation epoch を含めて評価する。
6. offscreen 化の候補を計測し、production wiring、設定キー、default、Offscreen document の API 制約を含めて評価する。
7. 3 方式の longtask 件数、最大 duration、duration 合計、測定条件を比較し、採用方式を 1 つ裁定する。
8. longtask 件数を判定へ追加するかの判断と、追加する場合の別 command・別 baseline を記録する。
9. 裁定結果、不採用方式の理由、残存制約、後続実装 PBI への引き継ぎ内容を定義する。
10. 本 PBI では production の最適化実装を行わず、計測結果と方式裁定を成果物とする。

## 見積もり

2 SP（現状ベースライン、longtask 件数と最大 duration の計測、3 方式の実測比較、適用方式の裁定まで。実装は別 PBI。）

## 技術的考慮事項

- 現状の `extractPageContent()`、`preparePageContent()`、`extractMainContentWithInfo()` は同期契約であり、TreeWalker と `cloneNode(true)` を使う。
- `cloneNode(true)` は production に2箇所あるため、測定対象の呼び出し位置を区別する。
- rAF の production 使用は popup 表示演出の1件だけで、content path には存在しない。
- `scheduler.yield` と `globalThis.scheduler?.yield` は production、test、entrypoints の合計で0件である。
- 大量 DOM 操作の規約は rAF batching + `scheduler.yield()` であり、content path に実装済みの batching とは扱わない。
- content 側の既存 scheduler は `requestIdleCallback` と `setTimeout` のみで、admission とスロットリングが DOM バッチや yield と同じ責務ではない。
- `cleanseViaOffscreen()` は存在するが production call site は0件で、`cleansing_offscreen_enabled` の default は false である。
- Offscreen document は `chrome.runtime` messaging と Web API のみ利用できる。
- 非同期化したホットパスは、ページ DOM を変更しない detached clone または text 抽出に限る。
- scheduler 非対応ブラウザの fallback と mutation generation epoch が必要である。
- `bench:check` は deterministic micro counter 4 種だけをゲートし、`bench:e2e` とは分離されている。
- E2E の `__benchLongTasks` は `entry.duration` の合計であり、longtask 件数ではない。`longTaskCount` は0件である。
- longtask 件数を判定へ追加する場合は、既存 `bench:check` の deterministic counter 方針と分離する。
- `contentExtractor` 周辺は namespace 再編の対象であり、bench の path 設計も別 PBI と依存・競合する。

## 実装者向け注記

### 現状コードの確認

- `StorageKeys.CLEANSING_OFFSCREEN_ENABLED = 'cleansing_offscreen_enabled'` は `src/utils/storage/types.ts:208-209` にある。
- `cleansing_offscreen_enabled` の default は `src/utils/storage/defaults.ts:87` と `src/content/cleansingOffscreenDelegate.ts:29-34` で false である。
- `cleanseViaOffscreen()` は `src/content/cleansingOffscreenDelegate.ts:14-38` にあるが、production call site は0件である。
- production の実ホットパスは `src/content/contentKernel.ts:99-101` の `extractPageContent()`、`src/utils/contentExtractor/pageContentPipeline.ts:7-11` の `preparePageContent()`、`src/utils/contentExtractor/index.ts:437-441` の `extractMainContentWithInfo()` である。
- `cloneNode(true)` の production 使用は `src/utils/contentExtractor/index.ts:221,276` の2箇所である。
- rAF の production 使用は `src/popup/optionsPanelsUI.ts:40` の popup 表示1件だけで、content path は0件である。
- `scheduler.yield` と `globalThis.scheduler?.yield` は production、test、entrypoints の合計で0件である。
- `src/content/scheduler.ts:25-31,41-43` は `requestIdleCallback` と `setTimeout` を使い、admission とスロットリングを行う。
- `bench:check` がゲートするのは `marker`、`clone_ai`、`clone_dedup`、`off_path` の deterministic micro counter 4 種で、定義は `bench/harness/report.mjs:229-248` と `package.json:80` にある。
- E2E の longtask 計測は `bench/e2e/autosave-latency.bench.ts:154-174` と `bench/e2e/content-script-impact.bench.ts:198-218` にある。
- `__benchLongTasks` は `entry.duration` の合計時間であり、longtask 件数ではない。`longTaskCount` は0件である。
- `bench:e2e` は `bench:check` から分離され、JSON baseline 比較をしない。関連定義は `package.json:82` と `docs/PERFORMANCE_TEST.md:79-89` にある。
- 既存テストは `src/content/__tests__/contentKernel.offscreen.test.ts`、`src/utils/contentExtractor/__tests__/index.clone-dedup.test.ts`、`src/utils/contentExtractor/__tests__/bytesize-lazy.test.ts`、`bench/micro/c4.clone-dedup.bench.mjs` である。

### 実装手順

1. 依存する `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` と `pbi/2026-09-25-14-refactor-ci-paths-filter.md` の対象範囲を確認する。
2. 対象ページ、実 DOM 分布、測定条件、longtask 件数、最大 duration、duration 合計の記録方法を固定する。
3. 現状の同期方式でページごとのベースラインを作成する。
4. 同期最適化候補を同じ条件で計測する。
5. 非同期 rAF batching + `scheduler.yield()` 候補を同じ条件で計測し、scheduler 非対応 fallback と mutation generation epoch を含む。
6. offscreen 化候補を同じ条件で計測し、production wiring、設定キー、default、Offscreen document の API 制約を評価する。
7. 3 方式の結果を比較し、採用方式を1つ裁定して不採用方式の理由を記録する。
8. longtask 件数を CI 判定へ追加する場合のみ、既存 `bench:check` と別の command と baseline を設計する。
9. 採用方式、未解決の制約、後続実装 PBI の変更範囲とテスト範囲を成果物へ引き継ぐ。
10. 本 PBI の実行は計測と方式裁定までにとどめ、production の最適化実装を行わない。

### 落とし穴

- `extractMainContentWithInfo` の同期契約をそのまま rAF 化した場合、preview の自動保存フローへ非同期化の伝播も検討対象になる。
- rAF batching だけに留めると、大量 DOM 操作の規約にある `scheduler.yield()` を省いてしまう。
- scheduler 非対応ブラウザで `scheduler.yield()` を前提にすると、候補方式の計測や後続実装が成立しない。
- ページ mutation を伴う非同期バッチを選ぶと、detached clone または text 抽出という制約に反する。
- mutation generation epoch を考慮しない非同期処理は、DOM の世代ごとの処理境界を記録できない。
- `cleansing_offscreen_enabled` の default を true にするだけで、production call site が0件のままの経路を有効とは判定しない。
- `__benchLongTasks` の合計時間を longtask 件数として扱うと、既存の longtask 件数計測を誤る。
- longtask 件数を既存 `bench:check` に入れると、deterministic micro counter のみをゲートする方針と衝突する。
- 3 方式で DOM 分布や測定条件を変えると、longtask 件数と最大 duration の比較を成立させない。
- `contentExtractor` の namespace 再編と bench の path 設計を同時に進めると、変更対象の判定が曖昧になる。

## 決定事項

5 Whys の結果として、方式選定の判断材料を次のように整理する。

1. **なぜホットパスが同期のままなのか。** 抽出 API が同期契約のまま設計されているためである。同期最適化、非同期 rAF batching + `scheduler.yield()`、offscreen 化の候補を同じ測定条件で比較する。
2. **なぜ offscreen を使わないのか。** `cleanseViaOffscreen()` の PoC は存在するが、production wiring とフラグがないためである。候補評価では production call site と設定経路を確認する。
3. **なぜ default-on だけではだめか。** production caller が0件であるためである。`cleansing_offscreen_enabled` の default を変更するだけでは経路が有効になるとは限らず、wiring の有無も判定条件にする。
4. **なぜ longtask 件数の計測がないか。** E2E は `entry.duration` の合計しかなく、CI gate は deterministic micro counter に限定されているからである。ページごとの longtask 件数と最大 duration を別々に記録し、既存 `bench:check` とは別の command と baseline を検討する。
5. **どれを選ぶべきか。** 実 DOM 分布で3方式の main-thread longtask 件数と最大 duration を比較し、測定結果に基づいて採用方式を1つだけ裁定する。裁定結果と production 実装は後続 PBI に引き継ぐ。

## Definition of Done

- [ ] 現状の production ホットパス、clone 使用箇所、offscreen delegate、設定キー、scheduler、bench の計測経路が確認済みである。
- [ ] ページごとに現行方式の main-thread longtask 件数と最大 duration のベースラインが記録されている。
- [ ] 同期最適化、非同期 rAF batching + `scheduler.yield()`、offscreen 化の実 DOM 分布・条件での比較結果が記録されている。
- [ ] 各方式について longtask 件数、最大 duration、duration 合計が区別されて記録されている。
- [ ] 採用方式を1つ裁定し、不採用方式の理由と残存制約が記録されている。
- [ ] offscreen 方式について default、production call site、production wiring、Offscreen document の API 制約が評価されている。
- [ ] scheduler 非対応時の fallback と mutation generation epoch の扱いが裁定されている。
- [ ] detached clone または text 抽出という、ページ DOM を変更しない条件が非同期方式の受け入れ条件として記録されている。
- [ ] longtask 件数を gate に含める場合、既存 `bench:check` と別の command・baseline とする方針が記録されている。
- [ ] 既存テスト4件と既存の deterministic micro counter の対象範囲が確認されている。
- [ ] `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md` と `pbi/2026-09-25-14-refactor-ci-paths-filter.md` への依存・競合点が記録されている。
- [ ] 本 PBI は計測と方式裁定に限定し、production の最適化実装を別 PBI に分けている。
