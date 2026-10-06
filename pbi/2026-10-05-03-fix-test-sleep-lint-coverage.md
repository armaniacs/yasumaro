# PBI: 固定待ち lint の適用範囲に穴（no-test-sleep と no-fixed-wait の管轄が噛み合わない）

## ユーザーストーリー

テストを書く開発者として、固定待ち lint の管轄穴を塞ぎたい。ルールの分割方針と config の適用範囲が実態と乖離し、将来の固定待ちが無警告で蓄積するから。

## 優先度

- 順位: 3/32
- RICE: 10.0（R5 / I2 / C1.0 / E1）
- 根拠: テスト追加のたびに穴が拡大する。このリポジトリの最重要規律（実時間待ちの禁止）が無警告で破られる
- 依存: なし

## 背景（file:line 現状）

- 管轄宣言 `eslint/rules/no-fixed-wait.mjs:14-16`: 「生の `setTimeout` は `no-test-sleep` の管轄」と明記
- 実際の適用 `eslint.config.js:158`: `files: ['src/**/__tests__/**/*.ts']` にのみ `no-test-sleep`（:180）と vitest 系ルール（:185, :193）が載る。`:209-215` の `testDir/**` / `bench/**` ブロックは `no-fixed-wait` のみ
- 検出実装 `eslint/rules/no-test-sleep.mjs:59-82`: Promise 内の `setTimeout` のみ検出し、member 呼び出しは対象外
- 結果として E2E spec / bench の生 `setTimeout` はどちらのルールにも掛からない。`testDir/__tests__` の vitest テストは `vitest/expect-expect`・`no-tautology-expect`・`no-vacuous-negative-wait`・`no-test-sleep` のすべてが対象外
- 現存の未検出実例: `testDir/e2e/overcut-guard-recording.spec.ts:116`（`setTimeout(r, 30)`、disable コメントなし）、`bench/e2e/content-hotpath-measure.mjs:50`（`setTimeout(r, 200)` の bounded poll）
- vitest ルール対象外のテスト群: `testDir/__tests__/i18nMock.test.ts` / `storageMock.test.ts` / `testPartition.test.ts` / `loggerMockFactory.test.ts` / `launchExtensionContext.test.ts` / `type-test-baseline.test.ts` / `archiveDbReader.test.ts`

## BDD受け入れシナリオ

```gherkin
Scenario: testDir の生 setTimeout が検出される
  Given testDir 配下のテストに理由なしの生 setTimeout がある
  When npm run lint を実行する
  Then local/no-test-sleep が error で検出する

Scenario: 正当な待ちは温存される
  Given testDir/waitPolicy.ts の 0ms 待機と理由付き disable の箇所がある
  When npm run lint を実行する
  Then それらは error にならない

Scenario: 管轄の記述が実態と一致する
  Given no-fixed-wait.mjs の管轄文
  When 読む
  Then 「E2E/bench の waitForTimeout と生 setTimeout は no-test-sleep が拾う」旨に書き換えられている
```

## 受け入れ基準

- [x] `eslint.config.js` の testDir ブロック（:209-215）に `local/no-test-sleep: error` が追加されている
- [x] vitest 系ルール群の `files` が `['src/**/__tests__/**/*.test.ts', 'testDir/__tests__/**/*.test.ts', 'eslint/__tests__/**/*.test.ts']` に拡張されている
- [x] `no-fixed-wait.mjs` の管轄文が実態に合わせて書き換えられている
- [x] 既存 2 実例（overcut-guard-recording.spec.ts:116 / content-hotpath-measure.mjs:50）は意図が正当なら理由付きの行頭 disable、そうでなければ条件待ちへ置換されている
- [x] `testDir/waitPolicy.ts:39` の 0ms は閾値 1ms 未満で温存され、既存テストが green
- [x] 静的検査のみの変更で、本番コードの try/catch には影響しない
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- ESLint ルールテスト: `eslint/__tests__` で新規適用範囲の検出ケースを追加（repeat-safe RuleTester 使用。`createRepeatSafeRuleTester`）
- 既存ルールテストが green。実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `eslint.config.js`（testDir/bench ブロックに no-test-sleep 追加、vitest 系の files 拡張）、`eslint/rules/no-fixed-wait.mjs`（管轄文の書き換え）、`testDir/e2e/overcut-guard-recording.spec.ts:116` と `bench/e2e/content-hotpath-measure.mjs:50` に理由付き disable
- 拡張したゲートが新規 5 件を検出（`bench/e2e/_fixtures.ts` 2 件・`launchExtensionContext.ts` 2 件・`repeatSafeRuleTester.test.ts` 1 件）。前 4 件は bounded な外部プロセス readiness poll のため理由付き disable、後 1 件は `expect(bodies, round)` の第 2 引数（vitest の expect は 1 引数）を `{ round, count }` の toEqual に修正
- ゲート: `npm run lint` 0 errors / type-check PASS
