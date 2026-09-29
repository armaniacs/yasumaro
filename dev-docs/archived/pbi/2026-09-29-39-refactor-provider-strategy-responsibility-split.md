# PBI: ProviderStrategy の責務分離（12 責務 → テンプレート + ポリシー群）

種別: refactor
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ3）。`src/background/ai/providers/ProviderStrategy.ts` は 632 行で 12 の責務を同時に持ち、テンプレートとポリシーが 1 ファイルに混在している状態を解消する。挙動は変えない。

## ユーザーストーリー

AI プロバイダの共通基盤を改修する開発者として、プロバイダを追加・変更するときに「既存ファイルを読み直さないと正しい実装が書けない」状態を解消したい。なぜなら 632 行のクラスにテンプレート・設定解決・リトライ述語・エラー写像が同居しており、どの変更がどの責務に影響するか追跡できないから

## 優先度

- 順位: 9 / 10
- RICE スコア: 1.0（Reach=3 / Impact=1 / Confidence=80% / Effort=2.5）
- 根拠: 挙動不変の整理であり、ユーザーに直接見える不具合の是正ではないため優先度は低い。PBI 35（AI プロバイダの失敗契約統一）が同じ `ProviderStrategy.ts` を触るため、その着地が前提となる。着手時に PBI 35 の変更と競合しないこと。また error 文面逆パース除去（`pbi/2026-09-28-00-backlog-refactor-round.md:62`）・リトライ述語統合（進行中 PBI 2026-09-28-29）との合流点をここで確定させる

## 現状と問題（file:line 証拠付き）

- `src/background/ai/providers/ProviderStrategy.ts` は 632 行で 12 の責務を持つ: ①型宣言 `:34-169` ②cost/rate pre-flight `:182-199` ③prompt 安全 `:205-214` ④テスト用 HTTP→エラー写像 `:219-283` ⑤summary テンプレート `:293-387` ⑥test テンプレート `:389-452` ⑦診断/log `:454-479` ⑧設定解決 3 種 `:465-471`,`:530-582`（timeout / content chars / max tokens の 3 つの優先順位ラダー）⑨応答後処理・debug `:481-510` ⑩リトライ述語 `:584-610`（`src/utils/fetch.ts:311-316` の `defaultShouldRetry` と重複し、`:351-352` の summary フローにのみ配線。test フロー `:420-425` は無配線で default を継承）⑪usage 計上 `:612-623` ⑫deprecated shim `:626-633`
- `handleErrorResponse` は interface の必須フック（`:126`）なのに production 到達不能（`:363-365` のコメントが `fetchWithRetry` が throw することを説明）。`src/background/ai/providers/OpenAIProvider.ts:195-201` と `GeminiProvider.ts:320-328` の実装は死んでいる
- HTTP→メッセージ写像が 3 系統: `mapConnectionError` `:219-228` / `parseAndMapFetchError` `:237-283` / summary フロー inline `:372-385`（ヘルパーなし・golden test 対象外）。timeout 判定の文面 sniff も 2 箇所で不一致（`:244` は 'timeout' も match、`:372` は 'timed out' のみ。`src/background/ai/failureTaxonomy.ts:220-224` は文面 sniff を非 signal と明言しており、構造化 `resolveFailure` が両サイトに既にある）
- テンプレート seam は 3 プロバイダ中 2 つしかカバーしない（BuiltInAiProvider は両テンプレート不使用: `ProviderStrategy.ts:298-299`、`src/background/ai/providers/BuiltInAiProvider.ts:74-79` が `checkPreFlight` / `getMaxTokens` をスキップ）
- parity テストが interface 契約の代替として機能していない（`src/__tests__/ai/providerParity.test.ts`）

## 改善方針（方向性）

1. テスト用エラー写像（`:219-283`）を `src/utils/httpFailureMessages.ts` 側へ追い出し、summary フロー inline（`:372-385`）も同じヘルパーを参照させる。timeout 判定の文面 sniff は 2 箇所で揃えるか、構造化 `resolveFailure` に置き換える
2. 設定解決 3 ラダー（`:465-471`,`:530-582`）を単一リゾルバに畳む。優先順位は既存挙動を保ったまま明文化する
3. リトライ述語は `src/utils/fetch.ts` 側に一本化する（進行中 PBI 2026-09-28-29 と合流）。test フローの無配線（`:420-425`）が default を継承しているため、統一时にこの差分が意図かを必ず確認する
4. BuiltIn のような非 HTTP プロバイダはテンプレート非依存の小クラスに分離する。parity テスト（`src/__tests__/ai/providerParity.test.ts`）を interface ベースに書き直し、3 プロバイダで同じ契約が検証されるようにする
5. `handleErrorResponse` は interface から削除するか、production 到達経路を持たせるかを ADR で裁定する。裁定前に interface 必須のまま放置しない

## BDD 受け入れシナリオ

```gherkin
Scenario: 新規 HTTP プロバイダ追加時に既存ファイルの論理修正が不要
  Given 新プロバイダ ID を catalog に追加する
  When factory を登録する
  Then ProviderStrategy.ts 本体の修正は不要である

Scenario: リファクタ後も parity テストが green
  Given 3 プロバイダの parity テスト
  When 責務分離を適用する
  Then 全 parity テストが挙動不変で green である

Scenario: エラー写像が単一の実装を持つ
  Given 同一の HTTP 失敗を summary フローと test フローに投入する
  When 両フローのメッセージを比べる
  Then 単一の実装（httpFailureMessages.ts 側）から導出され、timeout 判定が一致する

Scenario: 設定解決の優先順位が明示される
  Given timeout / content chars / max tokens の 3 設定が別々の優先順位で解決される
  When 単一リゾルバに置換する
  Then 解決順序がリゾルバ内の 1 箇所に記述され、解決結果は変更前と一致する
```

## 受け入れ基準

- [x] `ProviderStrategy.ts` からテンプレート群（`:293-452`）とポリシー群（`:219-283`、`:584-610`）が別モジュールへ移動し、クラスの責務が分離されている
- [x] 設定解決の 3 ラダー（`:465-471`,`:530-582`）が単一リゾルバに置かれ、解決優先順位が 1 箇所に記述されている
- [x] リトライ述語（`:584-610`）が `src/utils/fetch.ts:311-316` 側に一本化され、test フローの無配線（`:420-425`）が意図どおりか確認されている
- [x] HTTP→メッセージ写像が `src/utils/httpFailureMessages.ts` に集約され、timeout 判定の不一致（`:244` と `:372`）が解消している
- [x] `handleErrorResponse`（`:126`）の扱いを裁定した ADR が追加され、interface と実装の不整合が解消している
- [x] `src/__tests__/ai/providerParity.test.ts` が interface ベースに書き直され、3 プロバイダを同じ形でカバーしている
- [x] 外部から観測される挙動（summary / test の出力、失敗メッセージ、usage 計上）が変更前と一致する

## テスト戦略

- 単体: 分離後のポリシー群（timeout 解決・リトライ述語・エラー写像）の golden test
- 統合: 既存 `providerParity`・`parseFetchErrorParity`・`aiExtract-twins-parity` の維持

## 実装記録（2026-09-29）

### 分割の結果

| 移動先 | 移した責務 | 起点 |
|---|---|---|
| `src/background/ai/providers/HttpProviderStrategy.ts`（新規） | `executeHttpSummaryFlow` / `executeHttpTestFlow`、`HttpSummaryHooks` / `HttpTestHooks` 等の hook 型、`checkPreFlight` / `sanitizeContent` / `buildTestDebugBase` / `getAllowedUrlsForRequests` | `ProviderStrategy.ts:122-294` |
| `src/background/ai/providers/providerSettingsResolver.ts`（新規） | 単一ラダー `resolveProviderSetting` と timeout / maxContentChars / maxTokens の 3 解決 | `ProviderStrategy.ts` の各メソッド |
| `src/utils/httpFailureMessages.ts`（既存 Layer 0 へ集約） | `mapHttpConnectionFailure` / `mapHttpFetchFailure` / `isHttpTimeoutFailure` / `describeSummaryRequestFailure` | `ProviderStrategy.ts:129-197`、要約フロー catch の inline 分岐 |

`ProviderStrategy.ts` は 655 行 → 183 行。`AIProviderStrategy` は「送信手段に依存しない」基底になり、Gemini と OpenAI 互換は `HttpProviderStrategy` を挟んで継承、`BuiltInAiProvider` は基底だけを継承する（送信前ガードに構造的に手が届かない）。

### 判断（ADR 参照）

- `handleErrorResponse` は **interface から削除**（到達経路を与えるのではなく消す）。`fetchWithRetry` は non-ok で必ず throw するため分岐は到達不能。テンプレートには「エラー本文を parse しない」ガードだけを残し、返す文面は throw 経路と同じ汎用の 1 文にした。2 プロバイダの死んでいた実装も削除。
- リトライ述語は **provider 側で一切持たない**。`shouldRetrySummaryRequest` を削除し、要約フローからも `shouldRetry` を渡さない。要約・接続テストとも `src/utils/fetch.ts` の既定を継承する。
- timeout 判定は **広い方（`AbortError` / `timed out` / `timeout`）に揃える**。狭めると `parseFetchErrorParity` の golden が壊れるため採らない。production の transport は timeout を必ず `AbortError` 名 + `tagFailure(TIMEOUT)` で投げるので観測差分は出ない（ADR の Residual risks に記載）。
- parity テストは 2 プロバイダ比較ではなく **1 表 3 行**の形にした。Gemini / OpenAI 互換 / BuiltIn を同じ形で駆動し、`reachesTransport` だけで分岐する。

### 変更ファイル

新規: `dev-docs/ADR/2026-09-29-ai-provider-responsibility-split.md`、`src/background/ai/providers/HttpProviderStrategy.ts`、`src/background/ai/providers/providerSettingsResolver.ts`、`src/background/ai/providers/__tests__/HttpProviderStrategy.test.ts`、`src/background/ai/providers/__tests__/providerSettingsResolver.test.ts`

変更: `src/utils/httpFailureMessages.ts`、`src/background/ai/providers/{ProviderStrategy,GeminiProvider,OpenAIProvider,index}.ts`、`scripts/check-deprecated-aliases.mjs`（新モジュールが基底を import するため grandfathered に追加）、`dev-docs/{ARCHITECTURE_MAP,DESIGN_SPECIFICATIONS}.md`

テスト変更: `providers/__tests__/{ProviderStrategy,HttpProviderStrategy,providerSettingsResolver,parseFetchErrorParity,providerParity,httpSummaryFlow}.test.ts`、`src/utils/__tests__/httpFailureMessages.test.ts`（+ map* / timeout / 要約失敗の golden を追加）、`src/background/pipeline/__tests__/failureTaxonomy-contract.test.ts`（`FlowProbe` の基底を差し替え）、`src/background/__tests__/GeminiProvider.test.ts`（404 テストを「汎用の要約文 + `error: HTTP 404` + 本文を parse しない」に書き換え）

### 検証

```
npx vitest run src/background/ai    → 26 files / 382 tests passed
npx vitest run src/background       → 221 files / 2919 passed, 10 skipped
npx vitest run src/utils src/messaging → 324 files / 5658 passed
npx tsc --noEmit -p tsconfig.json   → 出力なし
npx eslint <変更ファイル>            → 出力なし
node scripts/check-deprecated-aliases.mjs → OK
npm run lint:layers-docs            → layer lists in sync
```

### BDD シナリオ → テストの対応

| シナリオ | テスト |
|---|---|
| 新規 HTTP プロバイダ追加時に基底の修正が不要 | `HttpProviderStrategy.test.ts` の静的ピン（基底が `fetchWithRetry` / `readJsonCapped` / `describeHttpFailure` / `shouldRetry` / `checkPreFlight` / テンプレートを持たない） |
| リファクタ後も parity テストが green | `providerParity.test.ts`（1 表 3 行） |
| エラー写像が単一の実装を持つ / timeout 判定が一致 | `src/utils/__tests__/httpFailureMessages.test.ts`（2 フローの判定一致を 6 種の carrier で固定） |
| 設定解決の優先順位が明示される | `providerSettingsResolver.test.ts`（`resolveProviderSetting` の rung 順序 + 3 設定の golden） |

### 逸脱・残作業

- **`src/utils/fetch.ts` は無改変。** 述語を公開して両フローで明示する案も検討したが、`shouldRetry` を渡さない方が「片方だけ述語を持つ」状態を構造的に作れなくし、transport の mock の改変も必要ないため採用しなかった。単一定義は `fetch.ts` に残るという点が受け入れ基準を満たしている。
- **`src/messaging/messageTransport.ts:42` のコメントは削除した `ProviderStrategy.shouldRetrySummaryRequest` を参照したまま。** 同ファイルは他 effort の WIP 対象のため編集せず、ADR の Residual risks に記載した。
- 受け入れ基準の「`src/__tests__/ai/providerParity.test.ts`」というパスは実在せず、実体は `src/background/ai/providers/__tests__/providerParity.test.ts`。後者を書き直した。
- `npm run validate` と全スイートは指示により未実行（上記の対象スイートのみ green 確認）。

## 見積もり

2.5 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る（指示により未実行。type-check・lint・alias ガード・layer docs は個別に green 確認）
- [ ] コードレビュー完了
