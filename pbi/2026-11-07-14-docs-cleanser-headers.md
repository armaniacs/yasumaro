# cleanser ヘッダーに実行段階を一行で明記する

> Rank: 5/5, RICE: 0.5 (R1 / I0.5 / C1.0 / E1), 依存: なし

## ユーザーストーリー

開発者として、5つの cleanser 系関数を読み違えずに区別したい。実行段階がヘッダー一行で分かるようになれば、誤った統合や誤った呼び出し順を防げる。

## 背景

holistic improvement diff の round で整理した判断として、5つの cleanser を統一しない。入力型と変更理由が異なるため、docs の one-liner 追加だけを行う。

確認済みソース (行番号は Read で再確認済み):

- `src/utils/contentCleaner.ts:301` `cleanseContent` - pre-extract、DOM hard-strip
- `src/utils/aiSummaryCleaner/index.ts:60` `cleanseAISummaryContent` - post-summary、rule-driven、DOM
- `src/utils/markdownSanitizer.ts:93` `sanitizeForObsidian` - string、emission-time
- `src/utils/piiSanitizer.ts:440` `sanitizeRegex` - string、record-time mask
- `src/utils/llmOutputGuard.ts:75` `isDegenerateOutput` - pure predicate、no rewrite
- `src/background/pipeline/piiBoundary.ts:33` `toExternalResult` - pre-emission seam、not sanitize

今回の作業は、このうち `contentCleaner` と `aiSummaryCleaner` の2ファイルに、各1行だけ実行段階を示すヘッダーを足すことである。コード移動は行わない。

## BDD シナリオ

### シナリオ 1: pre-extract 段階が文書化される

```gherkin
Given content 抽出前の DOM 整形を調べている開発者
When src/utils/contentCleaner.ts のファイルヘッダーを読む
Then pre-extract である旨の一行が記載されている
```

### シナリオ 2: post-summary 段階が文書化される

```gherkin
Given AI 要約後の DOM 整形を調べている開発者
When src/utils/aiSummaryCleaner/index.ts のファイルヘッダーを読む
Then post-summary である旨の一行が記載されている
```

### シナリオ 3: 他の sanitizer と混同しない

```gherkin
Given 5つの cleanser の使い分けを知りたい開発者
When 本 PBI の背景の file:line 対応表を読む
Then 各関数の入力型と実行段階の違いが文書で区別できる
```

## 受け入れ基準

1. `src/utils/contentCleaner.ts` のヘッダーに pre-extract を示す一行が含まれる
2. `src/utils/aiSummaryCleaner/index.ts` のヘッダーに post-summary を示す一行が含まれる
3. 追加は各ファイル1行のみで、関数シグネチャとロジックに差分がない
4. 振る舞い変更がない (既存テストの期待値更新が不要である)
5. 文字種が clean である (Shift-JIS safe、EM DASH を含まない)
6. 上記2ファイル以外のソースに差分がない

## ドキュメント手順

1. `src/utils/contentCleaner.ts:1` のヘッダーコメントに pre-extract の一行を足す
2. `src/utils/aiSummaryCleaner/index.ts:1` のヘッダーコメントに post-summary の一行を足す
3. `node scripts/check-docs-chars.mjs` で対象2ファイルの文字種を確認する
4. `git diff --stat` で変更が2ファイル各1行であることを確認する

## 見積もり

1SP (XS)

## DoD

- [x] 受け入れ基準 1 から 6 を満たす
- [x] ドキュメント手順 1 から 4 を実施した
- [x] 振る舞い変更がないことを diff で確認した
- [x] 文字種チェックが clean である
