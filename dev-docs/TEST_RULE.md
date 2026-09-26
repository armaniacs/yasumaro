# Test Rule

> AIが生成するテストの無力化（tautological assertion、無意味なモック比較、アサーション欠落）を防ぎ、テストの実効性を強制するためのルール。テストコマンドの一覧は[CONTRIBUTING.md](../CONTRIBUTING.md)、手動テストの観点は[TESTING_GUIDE.md](TESTING_GUIDE.md)を参照。Referenced from [AGENTS.md](../AGENTS.md).

## 絶対禁止事項

1. 自明に真となるアサーションを書かない（例: `expect(true).toBe(true)`、`expect(x).toEqual(x)`）
2. モックの戻り値をそのまま比較するだけのテストを書かない（実装ロジックや状態変化を検証しないテストは無意味）
3. アサーションのないテストを書かない（`it()` 内に `expect()` が一つも存在しないテストは禁止）
4. 実時間の経過に依存して待つテストを書かない（`await new Promise(r => setTimeout(r, N))`、`page.waitForTimeout(N)`。詳細は[実時間待ちの禁止と代替手段](#実時間待ちの禁止と代替手段)）

## テストの必須構造

- テストファイルは対応するソースと同じディレクトリの `__tests__/` 配下に `{filename}.test.ts` として配置する
- 単一ソースに対応しないテスト（統合テスト、複数モジュールにまたがる振る舞いテスト）は、対象モジュール群の共通親ディレクトリの `__tests__/` に、対象を表す名前で配置してよい。同一ソースの補完テストには接尾辞（`-r2`、`-comprehensive` など）を使用できる
- `describe(モジュール名) > describe(関数名) > test(内容)` の3階層を基本とする
- 依存関係はモジュールモック（`vi.mock()`）より DI（依存性注入）を優先する。モックが必要な場合は `vi.hoisted()` で巻き上げる
- `it()` の説明文は英語で記述する

```typescript
describe('sessionAlarmsManager', () => {
  describe('scheduleAlarm', () => {
    it('skips scheduling if alarm already exists', () => {
      const deps = createMockDeps({ existingAlarm: true });

      scheduleAlarm(deps, 'session-1');

      expect(deps.chromeAlarms.create).not.toHaveBeenCalled();
    });
  });
});
```

## 実時間待ちの禁止と代替手段

固定時間の待機は失敗しえないので、回帰を何も検出しない。実行時間を消費するだけで、負荷の高いマシンでは不安定の原因になる。待つのは条件の成立だけにする。方針の根拠と実測値は [ADR: ユニットテストの実行時間を契約として管理する](ADR/2026-09-26-test-suite-execution-time-contract.md)（R1・R2）を参照。テストが落ちたときの手順と完了判定は [AGENTS.md の Async / Timing Failures](../AGENTS.md#async--timing-failures) に従う。

### 待っているものごとの代替手段

ヘルパーは `testDir/waitPolicy.ts` にある。

| 待っているもの | 代替手段 |
|---|---|
| mock が呼ばれる・状態が変わる | `await waitForMock(() => expect(...).toHaveBeenCalled())`（`vi.waitFor` を interval 1ms で呼ぶ） |
| リトライのバックオフ・タイムアウト・debounce | 既存の差し替え口を使う: `src/utils/retryPredicate.ts` の `SleepFn`、`src/background/pipeline/stepExecutor.ts` の `StepDelayFn`、`ObsidianClientOptions.sleep`、`SqliteHistoryModelDeps.scheduler`。差し替え口がなければ `useTimerClock()` と `await vi.advanceTimersByTimeAsync(ms)` |
| 投げっぱなしの非同期処理の完了 | 本番コードから Promise を返す、または完了を表す `ready` / `whenIdle()` を公開する。直せない場合は `waitForMock()` で状態の成立を待つ |
| 並行処理テストでロックや処理を保持させる | 一定時間待つモックではなく、`Promise.withResolvers()` で完了をテスト側から制御する |
| タイマーを持たない経路で「起きなかった」ことを示す | `await drainMacrotask()`（マクロタスク 1 ターン） |
| E2E での描画・状態変化 | `await expect(locator).toBeVisible()`、`page.waitForFunction()`、`await expect.poll(() => ...)` |

`vi.useFakeTimers()` を既定の設定で使わない。既定では `setImmediate` と `queueMicrotask` も偽装されるので、動的 import を待つテストがタイムアウトまで止まる。`useTimerClock()` はタイマー API と `Date` だけを偽装する。

**`waitForMock()` を否定形のアサーションに使わない。** `vi.waitFor` はコールバックを
同期的に 1 回目から評価するので、`expect(mock).not.toHaveBeenCalled()` は待ち時間 0 で
成立する。「ガードが効いた」証明にならない。否定形は `drainMacrotask()` で
マクロタスク境界を 1 回跨がせてから評価するか、同じテスト内で完了を示す肯定
アサーションを先に置く。リトライタイマーまで跨ぐ必要がある場合は
`useTimerClock()` + `vi.advanceTimersByTimeAsync()` を使う。

```typescript
// NG: the mock holds the lock for 50ms and the test hopes the second call overlaps
mockGenerate.mockImplementation(async () => {
  await new Promise((r) => setTimeout(r, 50));
  return 'summary';
});

// OK: the test decides when the first call finishes
const first = Promise.withResolvers<string>();
mockGenerate.mockReturnValueOnce(first.promise);
const p1 = generator.generate();
const p2 = generator.generate();
expect(mockGenerate).toHaveBeenCalledTimes(1);
first.resolve('summary');
await Promise.all([p1, p2]);
```

### 本番コード側の書き方

時間に依存する処理（リトライ、タイムアウト、ポーリング、debounce）を新しく書くときは、書く時点で delay 関数や clock を注入できる形にする。テストが不安定になってから後付けしない。既定値は実タイマーのままでよい。panel や factory の層は deps をそのまま下の層へ渡す。途中の層で seam が途切れると、下の層に seam があってもテストは実時間を待つことになる。

### retry も同じ扱い

Vitest の `--retry` や Playwright の `retries` を増やしてテストを通すのは、固定待機と同じく失敗を隠すだけなので禁止する。反復実行による確認は `--retries=0` で行う。

### 例外

実時間そのものを扱うテスト（crypto のタイミング耐性、`bench/`）と、レート制限のある外部 API への意図的な間隔だけは許容する。該当行に `// eslint-disable-next-line local/no-test-sleep -- <条件で待てない理由>` を付ける。

### 静的チェック

`src/**/__tests__/` では、ESLint ルールが 2 つ働く。

- `local/no-test-sleep`（`eslint/rules/no-test-sleep.mjs`、`error`）:
  `new Promise(... setTimeout(resolve, N))` で N が 20 以上の待機を検出する。
  N は数値リテラルだけでなく `const DELAY_MS = 30` のような const 束縛も辿って
  解決する。解決できない値（引数、`let`、計算式）は推測せず見過ごす。
  違反がゼロになった 2026-09-26（PBI 2026-09-26-05）で `error` へ昇格済み。
- `local/no-greedy-fake-timers`（`eslint/rules/no-greedy-fake-timers.mjs`、`warn`）:
  `toFake` に `setImmediate` または `queueMicrotask` を含む `vi.useFakeTimers()` を
  検出する。既存 124 箇所の移行が残っているため `warn` であり、ゼロになったら
  `error` に上げる。新規コードが既定の書き方を広げるのを止めるのが今の目的。
- `local/no-vacuous-negative-wait`（`eslint/rules/no-vacuous-negative-wait.mjs`、`error`）:
  条件が否定アサーションだけ（肯定アサーションによるアンカーが無い）の
  `vi.waitFor` / `waitForMock` を検出する。上の「否定形に使わない」が
  機械で保証される。コールバック内に肯定アサレーションが 1 つでもあれば
  anchor になるので報告しない。「値が変わるまで待つ」意図の否定アサーションは
  待機呼び出しの**直前の行**に理由を付きで無効化する

`testDir/` は ESLint の対象外なので、E2E の `page.waitForTimeout()` は機械的には検出されない。レビューで確認する。

### ローカルルールのテスト

`eslint/rules/*.mjs` のテストは `new RuleTester` ではなく
`createRepeatSafeRuleTester`（`eslint/__tests__/repeatSafeRuleTester.ts`）で
`RuleTester` を組み立てる。`vitest --repeats` は `describe` 本体を再実行せず
`it` 本体だけを同じプロセス内で繰り返すのに対して、ESLint の `RuleTester` は
重複ケース検出用の `Set` を `describe` 本体で生成する。素の `RuleTester` だと
2 周目以降が自分のケースを重複と判定して落ちる。このラッパーは `RuleTester` の
`describe` / `it` 注入点に差し込み、周回ごとに新しいレジストリを作らせる。
ケースの一覧と検証内容は `RuleTester` のものそのままで、1 件も減らす必要がない。

新しいローカルルールのテストを追加するときは `createRepeatSafeRuleTester` を使う。
反復実行によるゲートは次のように実行する。

```bash
npx vitest run eslint/__tests__ --repeats=20
```

仕組みそのものは `eslint/__tests__/repeatSafeRuleTester.test.ts` が回帰を固定する。
採用した方式と却下した方式は
[ADR: ESLint ルールテストの `vitest --repeats` 対応](./ADR/2026-09-26-eslint-ruletester-vitest-repeats.md)
に記録してある。

## UI 機能追加・変更時のテスト必須化

UI に関わる機能追加・変更（新規パネル、ボタン、モーダル、タグ UI、フィルタ切替など）を行った場合は、**必ずテストを追加する**。追加を省略する場合は PR 説明に理由を明記し、レビュアーの承認を得る。

必須とするテストの観点:

- **レンダリング**: 追加・変更した要素が期待通りに表示されること（`hidden` 属性、`display`、`data-i18n` による文言解決、空文字でないこと）
- **旧 UI との共存**: 旧 UI を残したまま新 UI を追加した場合、旧要素が二重に表示されないこと。旧要素が `hidden` のままであることや、`simpleFormatUI` / `domainListSection` などの旧コンテナが新 UI 存在時に表示されないことを統合テストで検証する
- **インタラクション**: ボタン押下・タブ切替などのイベント配線が 1 回のみ行われること（`dataset.wired` などの二重配線防止を含む）
- **E2E**: 実拡張機能コンテキスト（`chrome-extension://.../options.html`）で、対象パネルを開いた際に期待する要素が可視であり、重複要素や空ボタンが存在しないことを Playwright で検証する

配置は `テストの必須構造` に従い、単一ソースのテストは `{filename}.test.ts`、新旧 UI の共存のような統合テストは共通親の `__tests__/` に `domainFilterUiIntegration.test.ts` のような名前で配置する。E2E は `testDir/e2e/` に `domain-filter-ui.spec.ts` のように配置する。

## 検索パス変更時の smoke test 必須化

テキスト検索・タグ検索・バックエンドの query routing に変更を加えた場合は、**必ず以下の smoke test を実行する**（round 14 のテキスト検索回帰の教訓: stub-based テストは SQL を実行しないため実行時エラーを検出できない）。

- **症状テスト**: `src/offscreen/__tests__/searchDistinctResults.test.ts` — 異なるクエリで異なる結果が返ること（text 欠落・routing 誤配送の両方を検出）
- **実エンジンテスト**: `src/offscreen/__tests__/realEngineLikeSearch.test.ts` — better-sqlite3 で出力 SQL を実行し、`no such column` クラスのエラーを検出
- **routing pin**: `src/offscreen/__tests__/sqlite-search-fts5.test.ts` — text ありの query が worker SEARCH メッセージに配送されること
- **UI E2E**: `testDir/e2e/dashboard-search-ui.spec.ts` — 検索ボックス入力からカード表示まで

テキスト検索に触る変更（queryNormalize / queryPlan / OpfsWorkerBackend / searchHandlers / sqliteQueryBuilder など）を行った場合は、上記 4 種のうち少なくとも「症状テスト」と「実エンジンテスト」を実行してからコミットすること。省略する場合は PR 説明に理由を明記する。

## AI生成テストのレビューチェックリスト

テストを提示する前（またはレビューする際）に以下を確認する:

- [ ] 実装ロジックを意図的に壊すと、このテストは FAIL するか
- [ ] 境界値・エッジケース（空配列、null、上限値など）を検証しているか
- [ ] アサーションはモックの戻り値ではなく、実装が生成した結果や状態変化を検証しているか
- [ ] テスト名は検証内容を具体的に説明しているか（「動作すること」のような曖昧な説明を避ける）
- [ ] 固定時間の待機や retry 回数の増加でテストを通していないか

## ミューテーションテスト（Stryker）

実装コードを自動で微修正（ミューテーション）し、テストがそれを検出できるか（ミューテーションを撃墜できるか）を測定する。`expect(true).toBe(true)` のような無意味なテストはスコアが上がらないため、無力化されたテストの検出に有効。

```bash
npm run test:mutate
```

設定は `stryker.config.json` にあり、`mutate` 対象は `src/**/*.ts`（テストファイルは除外）。`thresholds.break`（50%）を下回るとビルドが失敗する。CIへの統合は各ワークフローの設定に従う。

> **既知の制約**: `@stryker-mutator/vitest-runner` 10.0.0 は Vitest 5 に未対応で、ミュータントごとのテスト実行が 0 件のまま完走し、スコアが常に 0.00% になる。ランナーが Vitest 5 対応版（core と runner を同梱の新バージョン）をリリースされるまで `npm run test:mutate` のスコアは信頼できない。 代わりに「ローカル検証手順」の Red/Green 確認でテストの実効性を担保する。

対象範囲を絞って実行する場合は Stryker CLI の `--mutate` オプションで対象ファイルを指定する。

## ESLintによる静的チェック

`@vitest/eslint-plugin` により以下を静的に検出する（`eslint.config.js` で有効化済み）:

- `vitest/expect-expect`: `expect()` を含まないテストをエラーにする
- `vitest/valid-expect`: `expect()` の誤用（`await` 忘れ等）をエラーにする
- `no-self-compare`（ESLint組み込み）: `x === x` のような同一変数比較を警戒する
- `local/no-test-sleep`（ローカルルール）: 固定時間の待機を error で検出する（[実時間待ちの禁止と代替手段](#実時間待ちの禁止と代替手段)）
- `local/no-greedy-fake-timers`（ローカルルール）: 既定の toFake を使う `vi.useFakeTimers()` を warn で検出する
- `local/no-vacuous-negative-wait`（ローカルルール）: 否定アサーションしか条件に持たない待ちを error で検出する

```bash
npm run lint
```

## ローカル検証手順

AIにテストを書かせた直後は、実装を意図的に壊してテストが Red になるかを手元で確認する。

1. 対象の実装ファイルを一時的に改変する（戻り値を反転させる、条件式を逆にする等）
2. 該当テストを実行し、FAIL することを確認する

```bash
npx vitest run src/path/to/target.test.ts
```

3. 改変を元に戻し、テストが PASS することを確認する

このRed/Green確認は、PRチェックリストの「Red/Green検証」項目に対応する。
