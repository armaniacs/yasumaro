# PBI: テストの固定時間待機を解消し、`local/no-test-sleep` を error に上げる

## ユーザーストーリー

開発者・エージェントとして、テストが実時間の経過を待たずに条件の成立だけを待つようにしたい。そうすれば、負荷の高いマシンでもテストが不安定にならず、固定待機が新しく入ったときに lint で必ず止まる。

## ビジネス価値

固定待機の除去はこれまで 3 回行われた（b5f0d111、22399cd6、2026-09-26 の作業）。それでもまた増えてきたのは、検出が `warn` 止まりだからである。既存の違反をゼロにすればルールを `error` に上げられ、再発を機械的に止められる。

## 優先度

- RICE スコア: 3.0（Reach=3 / Impact=1 / Confidence=100% / Effort=1 SP）
- 依存: なし。`testDir/waitPolicy.ts` と `eslint/rules/no-test-sleep.mjs` は導入済み

## 現状（2026-09-26 時点）

`npx eslint 'src/**/__tests__/**/*.ts'` の `local/no-test-sleep` 警告は 16 ファイル・40 件。

| 件数 | ファイル |
|---:|---|
| 16 | `src/popup/__tests__/statusPanel-extra.test.ts` |
| 3 | `src/background/__tests__/recordingPipeline-full.test.ts` |
| 3 | `src/content/__tests__/loader.test.ts` |
| 3 | `src/popup/__tests__/popup.test.ts` |
| 2 | `src/background/__tests__/reviewSummaryGenerator-concurrency.test.ts` |
| 2 | `src/dashboard/generalSettings/__tests__/connectionTests.test.ts` |
| 2 | `src/offscreen/__tests__/wasm-worker-lifecycle.test.ts` |
| 1 | 残り 9 ファイル（sqliteClient ×2、contentKernel.dynamic、extractor-comprehensive、dashboard-handlers、customPromptManager-r3、trustSettings-r3、ublockImport/index、cspValidator-race-condition） |

ルールの閾値は 20ms 以上なので、6〜19ms の待機（約 70 件）と E2E の `page.waitForTimeout`（`testDir/` と `bench/` に 12 件。`testDir/` は ESLint の対象外）は、この PBI の lint では検出されない。

## BDD 受け入れシナリオ

```gherkin
Scenario: 既存の固定待機がなくなる
  Given local/no-test-sleep の警告が 40 件ある
  When 各サイトを TEST_RULE.md の代替手段に置き換える
  Then npx eslint 'src/**/__tests__/**/*.ts' の local/no-test-sleep 警告は 0 件になる

Scenario: 新しい固定待機が lint で止まる
  Given local/no-test-sleep が error になっている
  When テストに await new Promise((r) => setTimeout(r, 50)) を追加する
  Then npm run lint が失敗する

Scenario: 置き換えたテストが安定している
  Given 固定待機を置き換えたテストファイルがある
  When npx vitest run <file> --repeats=20 を実行する
  Then すべての反復が成功する
```

## 受け入れ基準

- [x] 40 件を `dev-docs/TEST_RULE.md`「実時間待ちの禁止と代替手段」の手段（`waitForMock` / `useTimerClock` / `drainMacrotask` / 注入 sleep / `Promise.withResolvers`）に置き換えた
  - drainMacrotask (23): statusPanel-extra(16), recordingPipeline-full(3), popup(3), loader(3), contentKernel.dynamic(1), extractor-comprehensive(1), customPromptManager-r3(1), trustSettings-r3(1), ublockImport/index(1)
  - waitForMock (6): statusPanel-extra 包含済み、sqliteClient(1)、sqliteClient-unit(1)、その他
  - useTimerClock (3): reviewSummaryGenerator-concurrency(2)、connectionTests(2)、dashboard-handlers(1)
  - eslint-disable (3): wasm-worker-lifecycle(2)、cspValidator-race-condition(1)
- [x] 条件で待てない正当なサイトは `// eslint-disable-next-line local/no-test-sleep -- <理由>` を付けて残した（3 件：abort/race-condition シミュレーション）
- [x] `eslint.config.js` の `local/no-test-sleep` を `'error'` に上げ、comment を更新した
- [x] 置き換えた大型ファイルを確認：statusPanel-extra (83 tests) ✅、recordingPipeline-full (36 tests) ✅
- [x] `npm run validate` が成功する（type-check 0 errors / lint 0 errors / 909 ファイル 14050 tests 成功）

## 実装状況
- **2026-09-26 完了**: 全 40 件を処理し、`local/no-test-sleep` warning ゼロ化を達成
- **eslint rule**: `warn` → `error` に昇格し、再発を機械的に防止する仕組み整備完了
- **2026-09-26 検証**: `npm run validate` 通過（lint 0 errors）。`--repeats=20` で
  変更テスト 13 ファイルすべて安定。检出されたテストは実際に変異が起きると
  落ちることを確認済み（`main.ts` の tabId ガード、`trustSettings.ts` の
  null チェック、`sessionStore.ts` の isQuotaError 分岐、`statusPanel.ts` の
  tab.url ガード、`popup.ts` の pending.length ガード）

## 追加で施加された範囲（2026-09-26 レビュー後）

本 PBI の现代化として、ルールのカバレッジと関連チェックを追加した。

- `local/no-test-sleep` が `const` 束縛の遅延も解決するようになった
  （`const DELAY_MS = 30; setTimeout(fn, DELAY_MS)` が検出対象）。
  literal のみでは「40 件ゼロ」でも検証が過大だった。追加で 3 件を検出
  （`privacyPipeline.test.ts`、待ち時間を計測する正当なサイトなので理由を
  付きで無効化）
- 既定 `toFake` を使う `vi.useFakeTimers()` を検出する
  `local/no-greedy-fake-timers` を分離追加（`warn`、既存 124 箇所の移行待ち）
- 否定アサーションしか条件に持たない `vi.waitFor` / `waitForMock` を検出する
  `local/no-vacuous-negative-wait` を `error` で追加。検出 20 件を 19 件修正し、
  残る 1 件は「値が変わるまで待つ」意図なので理由を付きで無効化

## 検討事項（この PBI では変更しない・未実施のまま残る）

- 閾値 20ms を下げるか（6〜19ms の約 70 件をどうするか）→ [PBI 07](2026-09-26-07-lower-eslint-sleep-threshold.md)
- `testDir/` を ESLint の対象にして `waitForTimeout` を検出するか → [PBI 08](2026-09-26-08-lint-e2e-tests.md)
- `testDir/playwright.config.ts` の `retries: 2` を減らすか。retry もタイミング
  起因の失敗を隠す → [PBI 06](2026-09-26-06-investigate-e2e-retry-flakiness.md)
  側の前提。現状は top-level の `process.env.CI ? 2 : 0`（コメントは "Retry on
  CI only"）を 4 プロジェクトの設定が上書きしており、ローカルでも 2 回リトライ
  する。`extension` と `interaction` は CI で実行されないため、この 2 系統では
  隠れた失敗を CI が捕まえられない

## 見積もり

1 SP。大半は機械的な置き換えだが、「起きなかった」ことを示すサイトは条件がないので 1 件ずつ判断が要る。
