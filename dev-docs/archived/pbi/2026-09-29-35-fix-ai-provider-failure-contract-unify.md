# PBI: AI プロバイダの失敗契約統一（FailureMetadata 付与・BuiltIn 生エラー排除・空文字成功の拒否・pinned origin 使用）

種別: fix
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ3）。3 プロバイダの失敗契約がまちまちで、breaker が失敗種別を参照できず、生例外文がページ要約として永続化される状態を解消する。

## ユーザーストーリー

拡張を利用者として、AI 要約の失敗がプロバイダごとに違う形で見えない状態が欲しい、なぜなら failure kind が無いと「設定ミス」と「一時障害」を breaker が区別できず、例外出力がページ要約として Obsidian に永続化されるから

## 優先度

- 順位: 5 / 10
- RICE スコア: 9.0（Reach=5 / Impact=2 / Confidence=90% / Effort=1.0）
- 根拠: 失敗経路の分類欠落は breaker の誤判断と永続化データの汚染という 2 つの実害に直結する。確実に観測できる挙動であり 90% を割れる。ただし本 PBI は `src/background/ai/providers/ProviderStrategy.ts` を直接触るため、進行中 PBI 2026-09-28-29（sender seam / retry 正規化）と競合しうる。着手前に両者の担当範囲と現在の作業ツリーを再確認し、重複変更にならないこと

## 現状と問題（file:line 証拠付き）

- breaker gate は `result.failure` を見るが、失敗経路のうち failure を付与しているのは 2 箇所だけ: `src/background/ai/RemoteAIService.ts:251-255`（gate 参照）、`:257`（最短長ゲート）
- `failInvalidSchema` は kind なし: `src/background/ai/providers/ProviderStrategy.ts:486-489`。OpenAI 経路 `src/background/ai/providers/OpenAIProvider.ts:259,262,266` と Gemini 経路 `GeminiProvider.ts:332,337` から呼ばれる
- テストフローの credential 欠如にも kind がない: `ProviderStrategy.ts:400-403`
- Gemini の model 名バリデーション（summary / test とも）: `GeminiProvider.ts:131`（summary）、`:201-222`（test）
- BuiltInAiProvider の全経路が kind なし: `src/background/ai/providers/BuiltInAiProvider.ts:84-88`, `:99-105`, `:128-137`, `:141-150`
- 結果として model 名誤りなど構成ミスが `FailureKind.CONFIGURATION` に分類されず、breaker からは分類不能な失敗として見える
- BuiltIn は生例外文を summary に埋め込む: `BuiltInAiProvider.ts:103` の `summary: \`Error: Failed to generate summary. ${errorMessage(error)}\``。他の経路は固定文 + detail 分離の規約に従う（`OpenAIProvider.ts:197-200`、`GeminiProvider.ts:325-327`、`ProviderStrategy.ts:375,382`）
- この summary は local path でページ要約として永続化される: `src/background/ai/LocalAIService.ts:52-64`
- OpenAI の summary パスは空文字 summary を `success: true` で通す: `OpenAIProvider.ts:264-274`。test パスは空を拒否（`:241-245`）、Gemini も拒否（`:342-360` summary / `:257-277` test）。空文字が拾われるのは下流の最短長ゲート（`RemoteAIService.ts:257`）だけ
- Gemini の pinned origin 定数が未使用: `GeminiProvider.ts:18` で `GEMINI_PINNED_ORIGIN` を定義するが、リクエスト URL は `:134` と `:209` でリテラル直書き。origin 検証対象（`:61`, `:67-68`）と実際の接続先が結ばれていない
- parity テストが 3 プロバイダ中 2 つだけ: `src/__tests__/ai/providerParity.test.ts:293-314`（retry parity）、`:342-393`（usage 記録）。BuiltInAiProvider は未カバー

## 改善方針（方向性）

1. `failInvalidSchema`・credential 欠如・model 名バリデーション・BuiltIn 全経路に `FailureKind`（schema 異常は SCHEMA、model 名・credential など構成ミスは CONFIGURATION）を付与する
2. `BuiltInAiProvider.ts:103` を他プロバイダと同じ「固定文 + `error` に detail 分離」に変更し、例外文が summary に出ないようにする
3. OpenAI の summary パスで空文字を拒否する。Gemini のような finishReason 文言は不要で、test パスの wording（`OpenAIProvider.ts:241-245`）に合わせれば足りる
4. `GeminiProvider.ts:134` と `:209` のリクエスト URL を `GEMINI_PINNED_ORIGIN` 経由にして、origin 検証（`:61`, `:67-68`）と接続先を一致させる
5. parity テストを BuiltInAiProvider に拡張し、3 プロバイダの失敗マトリクスを同一の形で検証する

### スコープ外（記録のみ）

- `handleErrorResponse` は production で到達不能（`ProviderStrategy.ts:363-365` のコメントが `fetchWithRetry` が throw することを説明）。ベースクラス再設計は別 PBI（39）
- リトライ述語の重複（`ProviderStrategy.ts:600-610` × `src/utils/fetch.ts:311-316`）は進行中 PBI 2026-09-28-29 のスコープ
- error 文面の逆パース除去は台帳行（`pbi/2026-09-28-00-backlog-refactor-round.md:62`）

## BDD 受け入れシナリオ

```gherkin
Scenario: schema 異常が breaker に見える
  Given プロバイダが schema 異常な応答を返す
  When 要約生成が失敗する
  Then result.failure に構造化された kind が付与され、RemoteAIService の breaker gate が参照できる

Scenario: 構成ミスが CONFIGURATION として分類される
  Given model 名不正、またはテストフローに credential がない
  When 要約生成が失敗する
  Then result.failure.kind が CONFIGURATION であり、breaker が種別で参照できる

Scenario: BuiltIn の失敗 summary は固定文
  Given built-in AI が例外を投げる
  When 要約生成が失敗する
  Then summary は固定文言で、detail は error に入り、例外文が summary に現れない

Scenario: 空の要約は成功として扱わない
  Given OpenAI 応答の content が空文字である
  When summary パスが完了する
  Then success: false で返り、failure が構造化されて Reasons へ到達する

Scenario: Gemini の接続先は pinned origin と一致する
  Given Gemini リクエストを検索・テストのいずれでも発行する
  When 接続先 URL を確認する
  Then GEMINI_PINNED_ORIGIN から導出され、リテラル直書きではない
```

## 受け入れ基準

- [x] `ProviderStrategy.ts:486-489` の `failInvalidSchema` に kind が付き、OpenAI（`OpenAIProvider.ts:259,262,266`）と Gemini（`GeminiProvider.ts:332,337`）の呼び出しが同じ構造を返す
- [x] `ProviderStrategy.ts:400-403` の credential 欠如に CONFIGURATION 系の kind が付く
- [x] `GeminiProvider.ts:131` と `:201-222` の model 名バリデーション失敗に CONFIGURATION が付く
- [x] `BuiltInAiProvider.ts:84-88`, `:99-105`, `:128-137`, `:141-150` の全経路が kind 付きの failure を返す
- [x] `BuiltInAiProvider.ts:103` の summary が固定文となり、例外文が `LocalAIService.ts:52-64` 経由で永続化されない
- [x] `OpenAIProvider.ts:264-274` が空文字 summary を拒否し、test パス（`:241-245`）と同じ拒否条件・同じ wording を使う
- [x] `GeminiProvider.ts:134` と `:209` の URL が `GEMINI_PINNED_ORIGIN`（`:18`）経由で導出され、origin 検証（`:61`, `:67-68`）と一致する
- [x] `providerParity.test.ts:293-314` と `:342-393` の parity テストが BuiltInAiProvider を含む 3 プロバイダを同じ形でカバーする

## テスト戦略

- 単体: 3 プロバイダの失敗マトリクス（各失敗経路 × kind 付与）と parity テストの BuiltIn 拡張。OpenAI の空 content、Gemini の空 finishReason、BuiltIn の例外送出一条を全て走らせ、summary に例外文が含まれないこと、固定文と `error` 分離が成立すること
- 統合: `RemoteAIService` の breaker gate（`RemoteAIService.ts:251-255`）が kind 付き failure を実際に分岐参照できることを、最短長ゲート（`:257`）に依存しない形で確認する

## 見積もり

1.0 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録（2026-09-29）

### 変更ファイル

| ファイル | 変更 |
|----------|------|
| `src/background/ai/providers/ProviderStrategy.ts` | `failInvalidSchema` に `FailureKind.HTTP` を付与（現在 `:497-509`）。`executeHttpTestFlow` の credential 欠如に `CONFIGURATION` を付与し、hook が kind を持てばそちらを優先（`:400-412`） |
| `src/background/ai/providers/GeminiProvider.ts` | model 名不正（要約 `:132-141` / テスト `:214-224`）とテスト URL 不正（`:226-243`）に `CONFIGURATION`。リクエスト URL 2 箇所を `GEMINI_PINNED_ORIGIN` 起点に導出。定数を export し、導出の回帰をテストから観測可能にした（`:19`） |
| `src/background/ai/providers/OpenAIProvider.ts` | summary パスで空文字を拒否（`:270-282`）。条件・文面ともに test パス（`:242-246`）と同一定義 |
| `src/background/ai/providers/BuiltInAiProvider.ts` | 4 経路すべてに kind 付与。例外時の summary を固定文にし、詳細は `error` へ（`:113-126`） |
| `src/background/ai/providers/__tests__/providerParity.test.ts` | 使用量記録ブロックを 3 プロバイダの `it.each` に統一。retry ブロックに BuiltIn の「request issued なし」条項を追加。失敗契約マトリクス（credential / model 名 / 空文字 / BuiltIn 例外隔離 / taxonomy kind 検証）と pinned origin 導出の 2 系統を追加 |
| `src/background/ai/providers/__tests__/BuiltInAiProvider.test.ts` | 例外時の summary 固定文・`error` 分離・kind 検証、throw が kind を持つ場合の優先、testConnection 2 経路の kind |
| `src/background/ai/providers/__tests__/aiExtract-twins-parity.test.ts` | schema 失敗の kind 一致（Gemini / OpenAI 5 経路） |
| `src/background/ai/providers/__tests__/httpTestFlow.test.ts` | credential 早期 return の期待値に `debug.failure` を追加（Gemini / OpenAI 互換の 2 テスト） |

### FailureKind の選択理由

| 失敗経路 | kind | 理由 |
|----------|------|------|
| `failInvalidSchema`（両プロバイダ共通） | `HTTP` | taxonomy に schema kind が無い。schema 異常は「応答が返ったが中身が使えない」＝応答側の欠陥であり、設定では直らない。`CONFIGURATION` だと breaker の `breakerInputFor` が ignore して「壊れたプロバイダが冷却されない」逆効果になる。`HTTP` は offline recovery にも入らない |
| テストフローの credential 欠如 | `CONFIGURATION` | 要約フロー側の既存ゲート（`:311-315`）と同じ読み。request issued なし・retry 無効 |
| Gemini model 名不正 / テスト URL 不正 | `CONFIGURATION` | 設定値（model 名・api version）で決まる不備 |
| OpenAI 空 content 拒否 | `HTTP` | 200 で本文が無い = 応答側の欠陥。schema 失敗と同義の契約 |
| BuiltIn client が `success:false` | `CONFIGURATION` | client は「モデル未ダウンロード」「フラグ無効」「ブロックされた内容」を 1 文の文面にまとめて返すだけで、taxonomy は文面分類を禁じている。いずれもユーザーが対処する状態なので breaker に ignore させる |
| BuiltIn 例外 catch（要約・接続テスト） | `resolveFailure(error)` ?? `CONFIGURATION` | .transport が tag した kind（`TIMEOUT` 等）があればそちらを優先。無タグの throw は対抗手段のない環境不備として扱う |

### 検証

```
npx vitest run src/background/ai                                    → 24 files / 362 tests passed
npx vitest run <9 out-of-tree provider consumer files>              →  9 files / 132 tests passed
npx tsc --noEmit -p tsconfig.json                                    →  No errors found
npx eslint src/background/ai/providers/                              →  No issues found
```

回帰ガード（挙動を戻して新テストが落ちることを確認済み）:

- OpenAI の空文字拒否を無効化 → parity 3 件が失敗
- Gemini の URL をリテラル直書きに戻す → 派生源ガードが失敗（値のみの検証では検出できないため、ソース読み取りによる出現回数ガードを追加）
- BuiltIn の summary へ例外文を戻す → parity 1 件 + BuiltInAiProvider 1 件が失敗

### 逸脱・注記

- **SCHEMA kind は新設しなかった。** `src/utils/failureTaxonomy.ts` は 7 kind の SSOT で、`failureTaxonomy.test.ts` が 7 件を固定し、`errorClassification.ts` の `FAILURE_KIND_TO_ERROR_TYPE`（`Record<FailureKindValue, …>`）と `providerBreaker.ts` の `breakerInputFor`（全 kind arms）が exhaustiveness を要求する。8 件目を足すのは layer 0 SSOT と breaker 政策表を跨ぐ変更で、本 PBI のスコープ（AI プロバイダ層）外。既存の `HTTP` を採用し、理由を `failInvalidSchema` の WHY コメントに残した
- **Gemini の空応答（`GeminiProvider._extractSummary` の `finishReason` 系）には kind を付けていない。** 受け入れ基準の指定が OpenAI 空文字と Gemini model 名バリデーションに限定されているため。schema 失敗と同じ `HTTP` を付けるかは別判断
- **`testConnection` の `message` は生例外文のまま維持。** 接続テストの message は設定画面のテスト表示専用でページ要約として永続化されない（永続化面は summary のみ）。既存テストの固定文言もそのまま
- **`GEMINI_PINNED_ORIGIN` を export した。** 値検証（URL が pinned origin から始まる）だけでは「同一リテラルの直書き」を検出できないため、導出そのものを固定する出現回数ガードをテストに置く必要があった
- **行番号のずれ**: 着手時、証拠に挙げた行番号は 4 ファイルすべてで一致していた（漂移なし）。上の表に書いた番号は変更後の位置。PBI 本文の唯一の記述誤りは parity テストのパスで、`src/__tests__/ai/` ではなく `src/background/ai/providers/__tests__/`
- **`RemoteAIService.ts:251-255` の breaker gate 自体は無改変。** 参照先（`result.failure`）に構造化 kind が乗るようになったことで分岐可能になる
- スコープ外（`handleErrorResponse`、retry 述語、error 逆パース）は未変更。`shouldRetrySummaryRequest`（`ProviderStrategy.ts:611-621`）も挙動不変
