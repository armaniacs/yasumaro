# PBI: 恒久 skip を検出する lint ゲートを追加する（再発防止）

- 種別: refactor
- RICE: 1.6（R3 × I1.0 × C0.8 / E1.5）
- 依存: **NN02 の後**（既存違反をゼロにしてからゲートを有効化する。NN01 の後でもある）
- 出所: autonomous-task-closer の残課題報告（2026-10-12）に対するなぜなぜ分析の結論
- 台帳: `pbi/2026-10-12-00-backlog-skipped-test-cleanup.md`

## ユーザーストーリー

保守担当の開発者として、テストを恒久的に skip したまま放置できない仕組みがほしい。なぜなら無条件 skip は**スイートが緑のままカバレッジだけを消す**ため、既存の洗い出し条件（TODO/FIXME/PBI/チェックボックス）にも失敗通知にも乗らず、2026-03 から 10 件が静かに残ったから。

## 優先度

- 順位: 3 / 3
- RICEスコア: 1.6（Reach=3 / Impact=1.0 / Confidence=0.8 / Effort=1.5）
- 根拠: 再発防止の Impact は中〜大だが、ルール実装＋誤検知の作り込みが必要で Effort が最大。かつ NN02 完了が前提のため最後。

## 背景（現状・根拠）

### なぜなぜ分析（2026-10-12）

1. なぜ死んだ skip が 10 件残ったか → 移行・リファクタ時に skip され、どのラウンドも所有しなかった。
2. なぜ所有されなかったか → 洗い出し条件（TODO/FIXME/PBI/チェックボックス/検証/バージョン/DoD/重複）に「無条件 skip」が無い。
3. なぜ条件に無いか → 無条件 skip は**テストが緑のまま**カバレッジだけを消すので、失敗として現れない。
4. なぜ手当てされないか → `skip` は条件付き（`skipIf` / `test.skip(cond, reason)`）では正当であり、単純禁止は誤検知する。
5. なぜ有効なゲートがまだ無いか → 正当な条件付き skip と恒久 skip を**構文で判別する設計**が必要で、誰も設計していない。
→ 解: 宣言形（`X.skip('名前', fn)`）の恒久 skip だけを報告し、実行時条件形（`X.skip(cond, reason)`）を許可する lint ルールを追加する。

### 判別規則（実測に基づく設計）

| 形 | 例 | 判定 |
|---|---|---|
| 宣言形（恒久） | `it.skip('name', fn)` / `describe.skip('name', fn)` | **報告** |
| 実行時条件形 | `test.skip(testInfo.project.name !== 'firefox', '...')` | 許可 |
| 実行時条件形 | `test.skip(true, HEADLESS_FIXME_MESSAGE)` | 許可 |
| 文脈依存の条件形 | `if (!process.env.CI && !process.env.DISPLAY) { test.skip(true, '...') }` | 許可 |
| 条件付き API | `describe.skipIf(!distExists)(...)` | 許可 |
| 実行時理由つき（Playwright） | `test.skip('reason')`（単一文字列引数） | 許可 |

判別子: **`it`/`test` は「第1引数が文字列リテラル かつ 引数が2つ以上」のときだけ報告**、`describe.skip` は「第1引数が文字列リテラル」で報告。単一文字列引数の `test.skip('reason')` は Playwright の実行時形なので許可する。

現状の違反候補（NN02 完了後に 0 件になる想定）: `src/background` 配下の宣言形 10 件（NN01 の 1 件 + NN02 の 9 件）。許可側の実在例: `testDir/e2e` の条件付き 8 件、`src/__tests__/manifest.test.ts` の `describeFn = manifestExists ? describe : describe.skip` 形、`describe.skipIf` 2 件。

## BDD 受け入れシナリオ

```gherkin
Scenario: 恒久 skip を書くと lint が止める
  Given テストファイルに it.skip('name', fn) がある
  When  ESLint を実行する
  Then  local/no-dead-test-skip が報告する
  And  修正方法（テストを直すか、理由つきで無効化する）がメッセージから分かる

Scenario: 実行時条件の skip は止めない
  Given test.skip(testInfo.project.name !== 'firefox', 'firefox-only') がある
  When  ESLint を実行する
  Then  報告しない
  And  test.skip(true, HEADLESS_FIXME_MESSAGE) / describe.skipIf(...) / if ガード内の test.skip(cond, reason) も同様に報告しない
```

## 受け入れ基準

- [ ] `eslint/rules/no-dead-test-skip.mjs` が追加され、上表の判別規則どおりに報告・許可する
- [ ] `eslint/__tests__/no-dead-test-skip.test.ts` が `createRepeatSafeRuleTester` を使って有効・無効の両ケースを pin している（AGENTS.md の `--repeats` 規約に従う）
- [ ] `eslint.config.js` の vitest 対象ブロックと `testDir/`（Playwright）対象ブロックの両方に配線されている
- [ ] 正例（許可）として上記の条件付き skip 5 形がすべて valid ケースとしてテストに含まれている
- [ ] ルールを有効化した状態で `npm run lint` が 0 errors（NN02 完了後の既存違反ゼロを前提。違反が残る場合は `warn` で導入し、解消後に `error` へ昇格する判断を記録する）
- [ ] `npx vitest run eslint/__tests__ --repeats=20` が green
- [ ] `npm run validate` が green

## テスト戦略

- ルール単体: `eslint/__tests__/no-dead-test-skip.test.ts`。invalid（宣言形 `it.skip('x', fn)` / `describe.skip('x', fn)` / `test.fixme('x', fn)`）と valid（実行時条件形・`skipIf`・`test.skip('reason')` 単一引数・非テストオブジェクトの `.skip()`）を網羅する。
- リポジトリ統合: `npm run lint` が既存コードベースで 0 errors のまま（＝誤検知ゼロの実証）。`testDir/e2e` の条件付き 8 件が valid であることがこの統合テストの実体になる。
- 回帰: 既存の `local/*` ルールテスト群が green。

## 見積もり

1.5 SP（ルール実装 0.75 ＋ ルールテスト 0.5 ＋ eslint.config.js 配線と既存コードでの誤検知掃除 0.25）

## 技術的考慮事項

- 既存の `local/no-greedy-fake-timers` は既存違反 124 件のため `warn` で導入された前例がある。本件は NN02 完了後なら違反 0 から `error` で導入できる。順序を守れない場合は `warn` 導入＋昇格 PBI を切る。
- `it.skip.each([...])('name', fn)` のような `each` 連結形は第1引数の解決が1段増える。初版では `CallExpression`/`MemberExpression` の連鎖を辿って `skip`/`fixme` を検出し、判別規則は同じ（文字列リテラル かつ 引数2以上）とする。`each` 形が誤検知する場合は valid ケースとして明示的に固定する。
- 非テストの `.skip()`（例: 配列/ストリームの skip）を誤検知しないよう、被呼び出しオブジェクト名が `it` / `test` / `describe`（およびそのエイリアス import 名）であることを条件にする。既存の `no-vacuous-negative-wait.mjs` 等がテスト API をどう判定しているかに倣う。
- AST 変更後は `graphify update .` の対象（AGENTS.local.md の規約）だが、eslint/rules は対象拡張子の確認が必要。

## 実装者向け注記

### 実装手順

1. NN02 完了後、`src`/`testDir` に宣言形 skip が 0 件であることを grep で確認する。
2. 既存ルール（`eslint/rules/no-vacuous-negative-wait.mjs` とそのテスト）を雛形にルールとテストを実装する。
3. `eslint.config.js` の該当ブロックへ配線し、`npm run lint` が 0 errors であることを確認する（誤検知の実証）。
4. `npx vitest run eslint/__tests__ --repeats=20` と `npm run validate`。

### 落とし穴

- `test.skip('reason')`（単一文字列）を誤検知すると Playwright 側で正当な実行時 skip が止まる。引数個数の条件を必ず入れる。
- `describeFn = manifestExists ? describe : describe.skip` のように**プロパティ参照としての `skip`**（呼び出しではない）は報告対象外。`CallExpression` の callee が `MemberExpression` のときだけ見る。
- ルールテストは `new RuleTester` ではなく `createRepeatSafeRuleTester` を使う（`--repeats` で重複ケース登録が衝突するため。ADR 2026-09-26 参照）。

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] type-check / lint / テストが通る（`npm run validate` green）
- [ ] `npx vitest run eslint/__tests__ --repeats=20` が green
- [ ] 検証結果（コマンドと結果）を PBI に記録する
- [ ] コードレビュー完了
