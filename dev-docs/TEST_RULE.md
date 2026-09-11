# Test Rule

> AIが生成するテストの無力化（tautological assertion、無意味なモック比較、アサーション欠落）を防ぎ、テストの実効性を強制するためのルール。テストコマンドの一覧は[CONTRIBUTING.md](../CONTRIBUTING.md)、手動テストの観点は[TESTING_GUIDE.md](TESTING_GUIDE.md)を参照。Referenced from [AGENTS.md](../AGENTS.md).

## 絶対禁止事項

1. 自明に真となるアサーションを書かない（例: `expect(true).toBe(true)`、`expect(x).toEqual(x)`）
2. モックの戻り値をそのまま比較するだけのテストを書かない（実装ロジックや状態変化を検証しないテストは無意味）
3. アサーションのないテストを書かない（`it()` 内に `expect()` が一つも存在しないテストは禁止）

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

## AI生成テストのレビューチェックリスト

テストを提示する前（またはレビューする際）に以下を確認する:

- [ ] 実装ロジックを意図的に壊すと、このテストは FAIL するか
- [ ] 境界値・エッジケース（空配列、null、上限値など）を検証しているか
- [ ] アサーションはモックの戻り値ではなく、実装が生成した結果や状態変化を検証しているか
- [ ] テスト名は検証内容を具体的に説明しているか（「動作すること」のような曖昧な説明を避ける）

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
