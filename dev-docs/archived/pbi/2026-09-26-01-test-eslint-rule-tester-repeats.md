# PBI: ESLint ルールテストを Vitest の `--repeats` 安定性ゲートに乗る構造にする

## ユーザーストーリー

開発者として、`dev-docs/TEST_RULE.md` と `AGENTS.md` が要求する `--repeats` 安定性ゲートを ESLint ルールテストにも適用したい。現状は 7 ファイルがゲートから実質除外されているため、「Unit/Integration は緑だが E2E/bench は未検証」のような、テスト種別ごとに検証の強度が違う状態が放置されている。

## ビジネス価値

- テスト種別ごとの検証強度の差を埋め、`--repeats` による「一度きりの green」を全ファイルで排除できる。
- ESLint ルール（テストの品質を機械的に守る層）自体のテスト安定性を保証できる。
- 今後追加されるローカルルールのテストが、最初からゲートに乗る状態になる。

## 優先度

- 種別: test
- 順位: 01 / 08
- RICEスコア: —（統合 PBI 2026-09-26-00 が「独立した PBI として扱う」と明記した未起票項目を引き継ぐ枠。個別 RICE 採点は未実施）

## 問題の実測（2026-09-26 時点）

`eslint/__tests__/` の 7 ファイルすべてが `--repeats` で 2 回目以降に自己衝突する。

```bash
$ npx vitest run eslint/__tests__/no-test-sleep.test.ts --repeats=20
 Test Files  1 failed (1)
      Tests  14 failed (14)
AssertionError: detected duplicate test case
```

```bash
$ npx vitest run eslint/__tests__/no-fixed-wait.test.ts --repeats=5
AssertionError: detected duplicate test case
```

## 根本原因

統合 PBI `2026-09-26-00` はこの現象を「test file が test 間で module state を保持している / Mock リセット不足」と推測していた。**その推測は誤り**である。

ESLint の `RuleTester` は、重複テストケース検出用の `Set` を `describe` コールバックの**本体**で生成する。

```js
// node_modules/eslint/lib/rule-tester/rule-tester.js:1907-1909
this.constructor.describe(ruleName, () => {
  if (test.valid.length > 0) {
    this.constructor.describe("valid", () => {
      const seenTestCases = new Set();   // ← describe 本体で 1 度だけ生成
```

Vitest の `--repeats` は**同じプロセス内で `it` の本体だけを再実行し、`describe` の本体を再実行しない**。したがって 2 周目以降の `it` は 1 周目が登録済みの `Set` を共有し、自分自身のケースを重複と判定して `detected duplicate test case` で落ちる。

つまり保持されている module state はテスト側の mock ではなく、**ESLint `RuleTester` が `describe` 本体に置いたレジストリ**であり、テスト側のMock リセットでは解けない。

## BDD受け入れシナリオ

```gherkin
Scenario: ルールテストが repeats ゲートで green を保つ
  Given ESLint ルールテストが 1 ファイル以上存在する
  When そのファイルを --repeats=20 で実行する
  Then 全周回が pass する
  And "detected duplicate test case" が出力されない

Scenario: 新規ルールのテストが最初からゲートに乗る
  Given 開発者が新しいローカルルールのテストを追加する
  When 新しいローカルルールのテストを追加する標準的な書き方（RuleTester の run 呼び出し）を用いる
  Then --repeats でも自己衝突しない
  And 追加の boilerplate を各ファイルに書く必要がない
```

## 受け入れ基準

- [x] `eslint/__tests__/` の全ファイルが `--repeats=20` で green になる。
- [x] 修正は各テストファイルに個別な後始末ではなく、共有の仕組みとして入る。
- [x] ESLint ルールのテスト内容（valid / invalid ケース）は減らない。
- [x] `npm run lint` の errors 0 を維持する（テスト除外による lint ゲートの弱体化をしない）。
- [x] `npm run validate` が PASS する。`validate` を構成する各ステップを個別に実行して
      すべて PASS した（`validate:json` / `lint` errors 0 / `check-innerhtml-escape` /
      `check-deprecated-aliases` / `type-check` / `npm test` = 921 ファイル
      920 passed + 1 skipped、14,260 テスト 14,239 passed + 21 skipped）。
- [x] `AGENTS.md` / `dev-docs/TEST_RULE.md` が要求する反復コマンドの書き方が、ESLint ルールテストにも適用可能であることを文書化する。

## テストケース数の Before / After

`--repeats` なしの通常実行（JSON レポーター）で比較した。

| ファイル | Before | After |
|---|--------|--------|
| `no-fixed-wait.test.ts` | 21 | 21 |
| `no-greedy-fake-timers.test.ts` | 10 | 10 |
| `no-test-sleep.test.ts` | 14 | 14 |
| `no-vacuous-negative-wait.test.ts` | 13 | 13 |
| `require-response-size-limit.test.ts` | 17 | 17 |
| `require-sanitized-markdown.test.ts` | 12 | 12 |
| `utils-layer-boundary.test.ts` | 20 | 20 |
| `repeatSafeRuleTester.test.ts`（新規） | — | 5 |
| **合計** | **107** | **112** |

ルールのケースは 107 件から 1 件も減っていない。+5 は共有機構の回帰固定テスト
（sentinel ルール 3 ケース + ラッパー 2 テスト）。

## 裁定

**採用: 案 1（`RuleTester` ラッパー）を、案 1 の前提を覆す形で採用した。**

「vitest に `describe` 本体を再実行させる方法がない」という前提は誤りと実測で
棄却した。Vitest に再実行 API は無いが、`describe` の本体は `RuleTester` 自身が
引数として保持しているため、ラッパーが覚えて自分で呼び直せる。PoC で
`--repeats=20` の pass を確認したうえで共有ラッパー
`eslint/__tests__/repeatSafeRuleTester.ts` として実装した。

| 案 | 判断 | 理由 |
|----|------|------|
| 1. `RuleTester` ラッパー | **採用** | `describe` / `it` / `itOnly` は `RuleTester` が公開している差し替え点である。`describe` 本体を保持して再実行すれば周回ごとにレジストリを作り直せる。アサーションは `RuleTester` の本体がそのまま実行するため、検証内容を再実装せずに済み、ケースを 1 件も減らさずに済む |
| 2. `RuleTester` を使わない | 却下 | `Linter` に適用して素の `it()` で書くと `messageId` + `data` / `suggestions` / `output` / ケース内フックを含む検証仕様を再実装することになる。テスト内容を減らさずに維持できる保証がなくなる |
| 3. pool / isolate で周回ごとに分離 | 却下 | Vitest 5.0.0 に反復ごとの分離設定が存在しない。`--repeats` は `runTest` 内のループ（`node_modules/vitest/dist/chunks/run.*.js:3855-3877`）で、`getFn(test)` だけを呼び直す。`--pool=threads` と `--no-isolate` を実測したが 14 件とも同じエラーで落ちた |
| 案外: `detected duplicate test case` を握り潰す | 却下 | 2 周目以降は全ケースが assertion に到達する前に必ずこのエラーが走るため、握り潰すとルールの本体が一度も実行されない。ゲートの目的を反転させる |

採用した方式・却下した方式の詳細は
[ADR: 2026-09-26-eslint-ruletester-vitest-repeats](../dev-docs/ADR/2026-09-26-eslint-ruletester-vitest-repeats.md)
に記録した。

## 変更ファイル

- `eslint/__tests__/repeatSafeRuleTester.ts`（新規。共有ラッパー）
- `eslint/__tests__/repeatSafeRuleTester.test.ts`（新規。共有機構の回帰固定）
- `eslint/__tests__/no-fixed-wait.test.ts`
- `eslint/__tests__/no-greedy-fake-timers.test.ts`
- `eslint/__tests__/no-test-sleep.test.ts`
- `eslint/__tests__/no-vacuous-negative-wait.test.ts`
- `eslint/__tests__/require-response-size-limit.test.ts`
- `eslint/__tests__/require-sanitized-markdown.test.ts`
- `eslint/__tests__/utils-layer-boundary.test.ts`
- `testDir/testPartition.ts`（`NEEDS_ISOLATION` に `repeatSafeRuleTester` を追加）
- `dev-docs/ADR/2026-09-26-eslint-ruletester-vitest-repeats.md`（新規）
- `dev-docs/ADR/README.md`（一覧に追記）
- `AGENTS.md`（Definition of done に ESLint ルールテストの反復コマンドを追記）
- `dev-docs/TEST_RULE.md`（§ 静的チェックに「ローカルルールのテスト」を追加）

## 残存スコープ

- ラッパーは `RuleTester` の静的接合点と「`run` が `describe` を 1 度だけ呼ぶ」
  という構造に依存する。ESLint 側が変更したら
  `eslint/__tests__/repeatSafeRuleTester.test.ts` が落ちる。ADR の R1〜R3 が
  前提を明記している。
- `eslint/__tests__/` は `tsconfig.json` にも `testDir/tsconfig.json` にも
  含まれておらず、`npm run type-check` の対象外である。本件では既存の 7 ファイルが
  対象に入っていなかったため、型検査の覆盖面を広げずにそのままにした。
  広げるなら 7 ファイルと新規 2 ファイルが一度に型検査の対象になる。

## テスト戦略（t_wadaスタイル）

### 検証コマンド

- `npx vitest run eslint/__tests__ --repeats=20` が全周回 pass すること。
- `npm run lint` / `npm run validate` が PASS すること。

### 共有仕組み自体の回帰防止

- `eslint/__tests__/repeatSafeRuleTester.test.ts` が固定する。周回ごとの再実行を
  意図的に壊して Red になることを確認してから戻した。

## 実装アプローチ

**裁定は「裁定」節に記録した。候補 1 の「解けない見込みが高い」という前提は
実測で棄却された。** 以下は着手時の候補一覧（原文のまま残す）。

候補（着手時に 1 つを選び、却下理由を記録する）:

1. **RuleTester ラッパーを共有する** — `eslint/__tests__/` 用の薄いラッパーを用意し、`RuleTester` の `describe` / `it` 静的注入を周回ごとに作り直す。vitest の `beforeEach` などで `describe` 本体を再実行する方法がないため、**ラッパーだけでは解決しない**見込みが高い。着手時に PoC で確認すること。
2. **`RuleTester` を使わない** — ルールを `Linter` に直接適用し、`lint()` 相当の検証を素の `it()` 内で書く。vitest 標準の「1 ファイル 1 周回」形状に寄るため repeats と相性が良い。ケースの書き換え量が多い。
3. **vitest の pool / isolate 設定で周回ごとに module graph を作り直す** — `--pool=forks` や `isolate` の挙動を確認して、ルールテストだけ周回ごとにプロセスを分離できるなら 它が最小変更。設定が test 全体へ波及しないことを必ず確認する。

 whichever を選ぶ場合も、**7 ファイル一括で適用できる**ことを条件とする。個別ファイルへの後始末は受け入れ基準を満たさない。

## 見積もり

1 SP

## 技術的考慮事項

- **推測で直さない**: 統合 PBI の「Mock リセット不足」という診断は誤り。着手時に再度根因を確認し、ADR に記録する。
- **ゲートを弱めない**: `--repeats` 対象からルールテストを外すだけで終える案は、テスト種別ごとの検証強度の差を残すため受け入れ基準を満たさない。
- **vitest 全体設定への影響**: 案 3 は `testDir/vitest.config.ts` 全体へ波及しうる。既存 14,100 テストの並列度と実行時間に影響しないことを測定する。
- **eslint 設定の ignores との混同**: `eslint.config.js` の `ignores` は「lint 対象から除外」であり、「vitest の実行対象から除外」ではない。両者を混ぜない。

## Definition of Done

- [x] 根本原因が ADR に記録されている。
- [x] `eslint/__tests__/` の全 7 ファイルが `--repeats=20` で green。
- [x] 採用した仕組みが共有の枠にあり、各ファイルへの個別後始末を含まない。
- [x] ルールのテストケース数が減っていない（107 → 107）。
- [x] `npm run lint` の errors 0（警告 145 件は本件と無関係な既存分）。
- [x] `npm run validate` の各ステップが PASS（`npm test` = 920 passed + 1 skipped）。
- [x] `AGENTS.md` / `dev-docs/TEST_RULE.md` の反復コマンド記載が本件の実態に一致している。
- [x] **未実施（ユーザー作業）**: GitHub PR レビュー。

## 未実施 — ユーザー作業

- GitHub PR レビュー。
