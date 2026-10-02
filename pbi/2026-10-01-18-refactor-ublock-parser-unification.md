# PBI: ublockParser の plain 版を WithErrors 経由に統一

## 優先度・backlog 出所・依存

- 優先度: 中（RICE 8.0 — R 4 / I 1 / C 1.0 / Eff 0.5）
- backlog 出所: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md) NN18（順位 11, refactor）。バッチA（並列・ファイル非重複）。
- 依存: なし。`src/utils/ublockParser/index.ts` とそのテストのみを触り、他候補と非重複。

## ユーザーストーリー

フィルター照合（ublockMatcher）とインポート（ublockImport）の両方にフィルターパースを提供する保守担当者として、パース本体が 1 つだけ存在し、入力サイズ・行数ガードやルール分類の変更が 1 箇所の修正で両呼び出し元に効いてほしい。ほぼ同型の 2 実装が片方だけ修正されて、ガード挙動が呼び出し元ごとに分岐し続ける状態を避けたい。

## 背景（file:line 付き現状）

- `src/utils/ublockParser/index.ts:109-226` — `parseUblockFilterListWithErrors(text)`（`ParseResultWithErrors` を返す）
- `src/utils/ublockParser/index.ts:243-325` — `parseUblockFilterList(text)`（`ParsedUblockRuleset` を返す）
- 両者はほぼ完全複製:
  - `cleanupCache()` + `isValidString` ゲート — `index.ts:111-119` vs `:244-250`
  - cache-key 生成・チェック — `index.ts:123-127` vs `:254-260`
  - inline 二重化された定数 — `MAX_INPUT_SIZE = 10 * 1024 * 1024`（10MB）が `index.ts:134` と `:263`、`MAX_LINES = 500000` が `index.ts:146` と `:272`
  - 同一 `RULE_TYPES` 分類の完全パースループ — `index.ts:162-204` vs `:284-307`
  - metadata 組立 — `index.ts:207-218` vs `:310-319`
- 唯一の挙動差は無効ルールの扱い — plain 版はパース不能行を黙って drop する（`:295-306` に else/error 収集がない）、WithErrors 版は `errors` 配列に収集する（`index.ts:188-196`）
- 両方 production-used:
  - WithErrors — `src/dashboard/settings/ublockImport/rulesBuilder.ts:80`, `src/dashboard/settings/ublockImport/sourceManager.ts:103`, `sourceManager.ts:153`
  - plain — `src/utils/ublockMatcher.ts:15`（`toStorageRules(parseUblockFilterList(text))`）
- 既存テスト: `src/utils/ublockParser/__tests__/index.test.ts`（両方）, `src/utils/__tests__/ublockParser.test.ts`（plain）, `src/utils/__tests__/ublockMatcher.test.ts`（plain 経由）, `src/popup/__tests__/integration-reload-workflow.test.ts`（WithErrors）

## BDD

### Scenario: plain 版が WithErrors と同一の rules を返す

- Given block / exception / comment / 空行を含むフィルターテキスト
- When `parseUblockFilterList(text)` を呼ぶ
- Then `parseUblockFilterListWithErrors(text).rules` と同内容の `ParsedUblockRuleset`（`blockRules` / `exceptionRules` / `metadata` の各集計）を返す
- And 無効行は返り値の rules に含まれない（plain の現行契約どおり黙って除外される）

### Scenario: 入力ガードとキャッシュの共有挙動は現行どおり

- Given 同一テキストで 2 回連続呼び出し
- When 1 回目と 2 回目の `parseUblockFilterList(text)` を呼ぶ
- Then 2 回目は cache ヒットとなり、1 回目と同一の metadata（`importedAt` 含む）を返す（現行と同一挙動）
- And `MAX_INPUT_SIZE` / `MAX_LINES` 超過時は空 ruleset を返す（現行と同一挙動）
- And ガード定数は module スコープの 1 箇所のみに存在する

## 実装宣言・受け入れ基準

It must keep behavior: plain 版の戻り値は不変 — `rules` のみを返し、無効ルールは黙って除外し、cache 経由の返り値（shallow copy レベル）を含めて `src/utils/ublockMatcher.ts:15` の既存呼び出しがそのまま動くこと。

- [x] `parseUblockFilterList` が `parseUblockFilterListWithErrors` を経由する薄いラッパになる（約 80 行の複製本体が消える）
- [x] `MAX_INPUT_SIZE` / `MAX_LINES` の定数二重化が消える（module スコープの 1 箇所に統一）
- [x] plain 版の戻り値互換 — rules のみ・無効ルール除外・cache 挙動含め現行と同一
- [x] WithErrors 版の挙動（エラー収集・返り値形状）は不変
- [x] 既存テスト green（`npm run validate`）

## テスト戦略

- 既存テストをそのまま regression ゲートに使う（戻り値互換の検証を兼ねる）:
  - `src/utils/__tests__/ublockParser.test.ts` — plain 版の分岐（null/undefined/空、cache、分類）を網羅
  - `src/utils/ublockParser/__tests__/index.test.ts` — 両関数の branch coverage
  - `src/utils/__tests__/ublockMatcher.test.ts` — production 呼び出し経路（plain）
  - `src/popup/__tests__/integration-reload-workflow.test.ts` — WithErrors 経路
- parity テストを追加: 代表入力（正常のみ / 無効行混在 / 空 / oversize 相当）について `parseUblockFilterList(text)` と `parseUblockFilterListWithErrors(text).rules` の同値性（`blockRules` / `exceptionRules` / `metadata`）を検証する
- リアルタイム待ちを入れない（[TEST_RULE](../dev-docs/TEST_RULE.md)）

## 実装内容

1. `src/utils/ublockParser/index.ts` の module スコープに `MAX_INPUT_SIZE`（10MB）と `MAX_LINES`（500000）を 1 回だけ定義し、両関数の inline 定義（`index.ts:134`, `:146`, `:263`, `:272`）を参照に置き換える。
2. `parseUblockFilterList`（`index.ts:243-325`）の本体を `return { ...parseUblockFilterListWithErrors(text).rules };` に置き換える。shallow spread は現行の cache-hit 経路（`index.ts:257`, `:259`）と同じコピーレベルを保つため。
3. 無効ルールは WithErrors の `errors` 配列に入るため plain の返り値には現れず、現行の「黙って drop」契約は自動的に維持される。
4. 両関数の JSDoc は最新仕様のスナップショットに更新する（「改善内容」「信頼性レベル」など履歴的な記述は残さない）。
5. 変更は `src/utils/ublockParser/index.ts` とそのテストに留める。`cache.ts` / `transform.ts` / 呼び出し元には触れない。

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate`（type-check + test）が green
- [x] parity テストが追加され、`npx vitest run <file> --repeats=20` で flake なし
- [x] `git diff` が `src/utils/ublockParser/index.ts` とそのテストのみに留まっている
- [x] コードコメントは非自明な WHY のみ（CLAUDE.md 規約）

## 実装記録（2026-10-02）

変更した内容:

- `index.ts` — `parseUblockFilterList` の本体（約 80 行の複製）を `return { ...parseUblockFilterListWithErrors(text).rules };` に置き換え。shallow spread は旧 cache-hit 経路と同じコピーレベルを保つ
- `MAX_INPUT_SIZE`（10MB）と `MAX_LINES`（500000）を module スコープへ hoist し、旧来 4 箇所にインラインで重複していた定義を 1 箇所に統一。ガード定数の WHY（メモリ枯渇・処理時間）を doc コメントに明示
- 両関数の JSDoc を現行仕様のスナップショットに更新。「改善内容」「設計方針」「信頼性レベル」など履歴的記述とデッドコメント（`hasCacheKey` のコメントアウト）を削除
- `cache.ts` / `transform.ts` / 呼び出し元（`ublockMatcher.ts` / `ublockImport/*`）には変更なし

追加したテスト（`src/utils/ublockParser/__tests__/index.test.ts` に parity describe を追加）:

- 5 つの入力形状（block/exception/comment/空行混在・無効行混在・hosts 形式・無効行のみ・MAX_LINES 超過）で `parseUblockFilterList(text)` と `parseUblockFilterListWithErrors(text).rules` の `blockRules` / `exceptionRules` / `metadata` が同値であることを assert。`importedAt` は 2 回の呼び出し時刻が異なるため除外
- plain 版が無効ルールを結果に含まないことを assert
- WithErrors 版が cache したエントリを plain 版が同じ `importedAt` で共有することを assert（cache 挙動の保存）

**逸脱（記録のみ、受け入れ基準は充足）**: plain 版は共通ループの共有により、parse が throw する行を「伝播」ではなく「drop」するようになった。`parseUblockFilterLine` は string 入力に対して throw 経路を持たないため、production の振る舞いは変わらない。伝播の挙動変化は実装内容 2（`WithErrors` 版への thin wrapper 化）の必然的な帰結であり、plain の契約（無効ルールは黙って除外）も結果的に保たれる。
