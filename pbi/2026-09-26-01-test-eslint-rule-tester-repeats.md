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

- [ ] `eslint/__tests__/` の全ファイルが `--repeats=20` で green になる。
- [ ] 修正は各テストファイルに個別な後始末ではなく、共有の仕組みとして入る。
- [ ] ESLint ルールのテスト内容（valid / invalid ケース）は減らない。
- [ ] `npm run lint` の errors 0 を維持する（テスト除外による lint ゲートの弱体化をしない）。
- [ ] `npm run validate` が PASS する。
- [ ] `AGENTS.md` / `dev-docs/TEST_RULE.md` が要求する反復コマンドの書き方が、ESLint ルールテストにも適用可能であることを文書化する。

## テスト戦略（t_wadaスタイル）

### 検証コマンド

- `npx vitest run eslint/__tests__ --repeats=20` が全周回 pass すること。
- `npm run lint` / `npm run validate` が PASS すること。

### 共有仕組み自体の回帰防止

- 共有仕組み本身（ラッパーがレジストリを周回ごとに作り直すこと）を固定するテストを 1 本置く。

## 実装アプローチ

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

- [ ] 根本原因が ADR に記録されている。
- [ ] `eslint/__tests__/` の全 7 ファイルが `--repeats=20` で green。
- [ ] 採用した仕組みが共有の枠にあり、各ファイルへの個別後始末を含まない。
- [ ] ルールのテストケース数が減っていない。
- [ ] `npm run lint`（errors 0）と `npm run validate` が PASS。
- [ ] `AGENTS.md` / `dev-docs/TEST_RULE.md` の反復コマンド記載が本件の実態に一致している。
- [ ] **未実施（ユーザー作業）**: GitHub PR レビュー。

## 未実施 — ユーザー作業

- GitHub PR レビュー。
