# ADR: ESLint ルールテストの `vitest --repeats` 対応は `RuleTester` の describe/it 注入点で行う

## ステータス
採用済み

## 日付
2026-09-26

## コンテキスト

`dev-docs/TEST_RULE.md` と `AGENTS.md` は、タイミング起因の失敗を検出するために
`--repeats` による反復実行をゲートとして要求する。`eslint/__tests__/` の 7 ファイルは
`--repeats` の 2 周目以降で全件落ち、`AssertionError: detected duplicate test case` に
なるため、このゲートから実質的に除外されていた。

### 保持されている状態の実体

落ちている原因はテスト側のモックではない。ESLint 10.10.0 の `RuleTester` が
**重複ケース検出用のレジストリを `describe` コールバックの本体に生成している**。

```js
// node_modules/eslint/lib/rule-tester/rule-tester.js:1906-1917
this.constructor.describe(ruleName, () => {        // 1906: ルート suite
    if (test.valid.length > 0) {
        this.constructor.describe("valid", () => {  // 1908
            const seenTestCases = new Set();        // 1909: describe 本体で 1 度だけ生成
            test.valid.forEach((valid, index) => {
                const item = normalizeTestCase(valid);
                this.constructor[valid.only ? "itOnly" : "it"](  // 1912
                    sanitize(item.name || item.code),
                    () => {
                        assertValidTestCase(item, seenTestCases);  // 1917
```

`invalid` 側にも同じ構造がある（`1944` の `describe("invalid")`、`1945` の
`new Set()`、`1953` の `assertInvalidTestCase`）。レジストリの生存期間は
`describe` 本体の実行回数に等しく、`it` 本体の実行回数には依存しない。

Vitest 5.0.0 の `--repeats` は `runTest` 内のループであり
（`node_modules/vitest/dist/chunks/run.*.js:3855-3877`）、
`for (let repeatCount = 0; repeatCount <= repeats; repeatCount++)` が
`getFn(test)`、つまり `it` 本体だけを呼び直す。`describe` 本体の再実行も、
ワーカーの作り直しも、反復ごとのモジュールグラフの作り直しも行わない。

したがって 2 周目以降の `it` は 1 周目が登録済みの `Set` を共有し、自分自身のケースを
重複と判定して落ちる。**モックのリセットでは解けない。** 問題の状態は
テスト側ではなく `RuleTester` 側にある。

### `RuleTester` が公開している接合点

`RuleTester` は `describe` / `it` / `itOnly` を**設定可能な静的プロパティ**として
公開している（`rule-tester.js:954-971`）。ソース中のコメント（949-953 行）はその
理由を、watch 実行では `describe` と `it` のインスタンスが実行ごとに変わるからだと
明記している。テストランナーが登録関数を差し替えるための公開された接合点である。

## 関連するADR
- [ユニットテストの実行時間を契約として管理する](./2026-09-26-test-suite-execution-time-contract.md)
- [module 級 singleton と composition root の併存方針](./2026-09-17-module-singleton-policy.md)

## 決定事項

`RuleTester` を維持したまま、`describe` / `it` / `itOnly` の静的注入点を使う
**反復安全なラッパー**（`eslint/__tests__/repeatSafeRuleTester.ts`）を
`RuleTester` のテストに共有させる。規則は 6 つ。

### R1. 周回ごとにレジストリを作り直す

注入したプロキシは `RuleTester.run` が呼んだ `describe` の**本体を覚える**。
`beforeEach` でその本体をもう一度実行し、`RuleTester` に新しい `Set` を作らせ、
得られた `it` 本体を登録済みのテストに差し替える。

Vitest に `describe` 本体を再実行する API はないが、**`describe` 本体は
`RuleTester` 自身が引数として保持している**。保持して自分で呼び直せばよい。
重複検出は各周回で通常どおり機能する。1 周回の中で 2 ケースが同じ内容なら
検出されて落ちる。

### R2. ケースは添字で突き合わせる

ケースのキーは名前ではなく**登録順の連番**（`0, 1, 2, ...`）とする。同名の
ケースが 2 件あるのは正当であり、名前でキーにすると片方が他方の本体を受け取る。
登録時の並び順と再実行時の並び順は `RuleTester` が同じ順番で `it` を呼ぶので
必ず一致する。

### R3. `describe` の深さでルート判定をしない

Vitest は `describe` の本体を**遅延実行**する。計測したところ、ネストした
`describe("valid")` / `describe("invalid")` は、ルート `describe` がスタックから
戻った**後**に呼ばれる。`describe` 呼び出しの深さは 0 のまま本体が実行される。
よって深さではルートを判定できない。`RuleTester.prototype.run` を一段包み、
その実行中に次に呼ばれる `describe` をルートとして記録する。

### R4. 再実行は名前付き束縛を通して行う

`afterAll` は静的プロパティを復元する。モジュールレジストリを共有するワーカーでは
先に読み込まれたファイルの `afterAll` が復元を済ませており、静的プロパティを辿ると
**テスト関数の中から本物の suite 関数を呼んでしまう**
（`Calling the suite function inside test function is not allowed`）。
プロキシを名前付き束縛として持ち、再実行はそれを直接呼ぶ。

### R5. このラッパーを使うファイルは隔離実行に回す

`repeatSafeRuleTester` はモジュールスコープにレジストリを持ち、`RuleTester` の
静的プロパティを差し替える。`testDir/testPartition.ts` の `NEEDS_ISOLATION` に
`repeatSafeRuleTester` をパターンとして足し、`isolated` プロジェクトに固定する。
これは同ファイルの既文「モジュールやグローバル状態を差し替えるものは隔離する」的
方針の適用である。`shared` プロジェクト（`isolate: false`）に置くと、同じワーカーの
2 件目以降が `beforeEach` の登録漏れと静的プロパティの復元漏れになる。

### R6. アサーションは再実装しない

登録された `it` は本物の `RuleTester` 本体を実行する。`messageId` と `data` による
メッセージ照合、複数エラーの順序、`suggestions`、`output`、ケース内
`before` / `after` フックなど、`RuleTester` の検証仕様がそのまま残る。
ラッパーの仕事はレジストリの生存期間だけを調整することであり、検証する能力を
増やさない。共有機構そのものには回帰固定テスト
（`eslint/__tests__/repeatSafeRuleTester.test.ts`）を置く。

## 却下した選択肢

いずれも実測してから判断した。

| 案 | 判断 | 実測した理由 |
|----|------|--------------|
| `RuleTester` を弃て、`Linter` に適用して素の `it()` で書く | 却下 | アサーション仕様を再実装することになる。`messageId` と `data`、`suggestions`、`output`、ケース内フックを等人で書くことになり、検証する能力の維持を保証できない。107 ケースをそのまま移せる点は有利だが、R6 の担保を捨てることになる |
| `--pool` / `isolate` / `sequence.shuffle` 相当の設定で周回ごとにモジュールグラフを作り直す | 却下 | Vitest 5.0.0 に反復ごとの分離設定が存在しない。`--repeats` は `runTest` 内のループであり（`run.*.js:3855-3877`）、ワーカーもモジュールグラフも反復ごとに作り直されない。`--pool=threads` と `--no-isolate` を実測したが 14 件とも同じ `detected duplicate test case` で落ちた |
| `it` 本体で `detected duplicate test case` を握り潰す | 却下 | 2 周目以降は全ケースの assertion に到達する前に必ずこのエラーが走るため、握り潰すと**ルールの本体が一度も実行されない**。`--repeats` の目的を反転させる |
| ラッパーでは解けないという前提 | 棄却 | 実測で否定。R1 の通り `describe` 本体は `RuleTester` が引数として保持しており、呼び直せる |

## 結果

### メリット

- `eslint/__tests__/` の全 8 ファイルが `--repeats=20` で全周回 pass する
- ルールのテストケースは 107 件のまま。1 件も減っていない
- 今後追加するローカルルールのテストは `createRepeatSafeRuleTester` を使うだけで
  はじからゲートに乗る。ファイルごとの後始末は不要
- `RuleTester` の検証仕様は変更されない。将来 `RuleTester` 側に検証項目が
  追加されても、追跡は不要になる

### デメリット

- `RuleTester` の内部構造（`describe` / `it` / `itOnly` の静的接合点と、`run` が
  `describe` を 1 度だけ呼ぶこと）に依存する。ESLint 側が変更したら R1 から R3 の
  前提が崩れ、`repeatSafeRuleTester.test.ts` が落ちる
- ケース数 N のファイルで、1 周回あたり N 回分のケース生成が走る。N が 20 程度では
  測定できるほどの差はない（8 ファイル合計 107 ケースで 1.86s）
- globals に依存する（`globals: true`）。これは `RuleTester` 側がもともと
  グローバルへフォールバックする条件と同一

### 影響範囲

| ファイル | 変更 |
|---|---|
| `eslint/__tests__/repeatSafeRuleTester.ts` | 新規。共有ラッパー |
| `eslint/__tests__/repeatSafeRuleTester.test.ts` | 新規。共有機構の回帰固定 |
| `eslint/__tests__/*.test.ts`（7 ファイル） | `new RuleTester` を `createRepeatSafeRuleTester` に置換。ケースは変更なし |
| `testDir/testPartition.ts` | `NEEDS_ISOLATION` に `repeatSafeRuleTester` を追加（R5） |

`testDir/vitest.config.ts`（pool / maxWorkers / projects）は変更していない。

### 実測した副作用

`testPartition.ts` の変更で `shared` プロジェクトから `isolated` へ移るのは
`eslint/__tests__/` の 6 ファイルだけだった（新規の回帰固定テストを含む）。

| プロジェクト | 変更前 | 変更後 |
|---|--------|--------|
| shared のファイル数 | 276 | 270 |
| isolated のファイル数 | 644 | 650 |

スイート全体は 921 ファイル / 14,260 テストで green である。`shared` 全体も
`--sequence.shuffle` を含めて green である。固定費用は 6 ファイル分だけ増えるが、
[同为日の ADR](./2026-09-26-test-suite-execution-time-contract.md) の
「固定費用はファイル数で増える」に照らすと 6 ファイル分は誤差の範囲である。

なお本測定のマシンは 8 コアに対し load average が 17 から 22 の状態で、wall の
絶対値は棄却した（同 ADR の R5）。判定は load ではなくファイル数で行っている。

## 検証方法

- ルールのテストケースが減っていないことを、通常実行（`--repeats` なし）の JSON
  レポートのテスト数で Before / After 比較する
- ラッパー自体を壊して（周回ごとの再実行をやめる）回帰固定テストが Red になる
  ことを確認してから戻す
- `--repeats` を付けた実行と付けない実行の両方が green であることを確認する
- 追加した隔離パターンを外した状態で `shared` を shuffle 実行すると、共有
  レジストリの漏えいが失敗として出ることを確認する

## Implements
- `eslint/__tests__/repeatSafeRuleTester.ts`
- `eslint/__tests__/repeatSafeRuleTester.test.ts`
- `testDir/testPartition.ts`

## 参照
- `dev-docs/TEST_RULE.md`
- `AGENTS.md`
