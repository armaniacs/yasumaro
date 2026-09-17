# PBI: AI プロバイダーの障害文言 SSOT 未採用経路の解消

優先度: 順位 1 / 4（RICE: 8.0 = Reach 5 / Impact 2 / Confidence 0.8 / Effort 1 pt。全候補5件中2位、1位は台帳清掃）
backlog: [2026-09-17-00-backlog-arch-review-0917b.md](2026-09-17-00-backlog-arch-review-0917b.md)（台帳）
依存: なし

## ユーザーストーリー
ローカル AI（lm-studio / ollama など）を設定したユーザーとして、要約や接続テストでネットワーク系エラーが起きたときは設定中のプロバイダー名で案内してほしい、なぜなら「OpenAI の API キーを確認してください」と表示されると原因の切り分け先を誤るから。

## 背景（現状と課題）
- `GenericOpenAICompatibleProvider` は openai / lm-studio / ollama / openai-compatible 等を1クラスで担う（`createProviderStrategy` の振り分けとコンストラクタの `providerName` 受け取りを読み取りで確認）。
- 一方 `GenericOpenAICompatibleProvider` の `testConnection` 内の `executeHttpTestFlow` 呼び出しは、`providerLabel` には `this.providerName` を渡す一方で、`fetchErrorLabel` には `'OpenAI'` を固定で渡している（`testConnection` 定義内の hooks 渡しを読み取りで確認）。
- `executeHttpTestFlow` の catch 節は fetch スロー時 `parseAndMapFetchError` に `hooks.fetchErrorLabel` を渡す（`executeHttpTestFlow` の catch 節を読み取りで確認）。このため lm-studio / ollama / openai-compatible 設定で HTTP 応答なしのネットワーク系エラー（Failed to fetch、timeout 等、HTTP ステータスを運ぶ fetch スローを含む）が起きると、ラベル埋め込み分岐で「OpenAI」と誤表示される。
- 本件は PBI 01（archived: `2026-09-17-01-fix-ai-provider-test-label.md`）が `mapConnectionError`（HTTP 応答あり）経路を `this.providerName` 化した残しである。PBI 01 の本文にも catch 側の `'OpenAI'` 渡しが対象外として明記されている。
- 第2の問題として、`AIProviderStrategy` の `parseAndMapFetchError` 定義（`ProviderStrategy.ts` 中盤）が fetch スロー経路用の status から文言へのテーブルを個別実装しており、`utils/httpFailureMessages.ts` 全体の `describeHttpFailure`（`mapConnectionError` 経路の SSOT。`mapConnectionError` 定義の委譲を読み取りで確認）と文言が揺れている。例として 401 系は parse 経路が `Invalid API key (401). Check your ${label} API key settings.` 形式なのに対し、`describeHttpFailure` 側は `Authentication failed (401). Check your ${label} API key.` 形式である（両ファイルの該当分岐を読み取りで確認）。429 / 5xx / Failed to fetch / フォールバック分岐を含むテーブル全体が重複している。
- 付随する整理として、`ProviderStrategy.ts` の `HttpTestHooks` 定義直後に `MAX_AI_HTTP_RESPONSE_BYTES` の import と re-export がファイル途中に置かれている（`HttpTestHooks` 定義周辺を読み取りで確認）。先頭の import ブロックへ移動する整理を本 PBI に含める。
- 前提として `utils/httpFailureMessages.ts` の `describeHttpFailure` は存在し、`utils/backoff.ts` も存在する（両ファイルの読み取りで確認）。

## BDD受け入れシナリオ
```gherkin
Scenario: lm-studio 設定でネットワークエラーが起きたら OpenAI と誤表示されない
  Given プロバイダーに lm-studio を設定している
  When 要約または接続テストでネットワークエラー（Failed to fetch）が発生する
  Then 失敗メッセージに OpenAI という語を含まない（現行の無ラベル文言を parity pin し、文言自体は変えない）

Scenario: parse 経路の委譲後も全文言が移行前と byte-identical である
  Given parse 経路の各ステータス（401 / 403 / 404 / 429 / 5xx / Failed to fetch / フォールバック）
  When `describeHttpFailure` に追加した parse 経路プリセットに委譲する
  Then 全文言が移行前と byte-identical である（parity テストで pin）

Scenario: HTTP ステータスを運ぶ fetch スローでは設定中のプロバイダー名で案内される
  Given プロバイダーに lm-studio を設定している
  When 接続テストの fetch が HTTP 401 を運ぶエラーでスローする
  Then 失敗メッセージに lm-studio が含まれ、OpenAI という語を含まない
```

## 受け入れ基準
- [x] lm-studio / ollama / openai-compatible 設定で fetch スロー経路（`executeHttpTestFlow` の catch 節経由）の全分岐に OpenAI 固定表示が出ない
- [x] ラベルを埋め込む分岐（401 / 403 系・5xx 系）では設定中の `providerName` が表示される
- [x] parse プリセット委譲後の全文言が移行前と byte-identical である（401 / 403 / 404 / 429 / 5xx / Failed to fetch / フォールバック分岐を含む）
- [x] 第1テーブルとの文言統一の要否が判断ポイントとして記録され、合意なく文言を変更しない
- [x] `HttpTestHooks.fetchErrorLabel` が廃止され `providerLabel` に統一されている（`GeminiProvider` 側の hooks 渡しを含む）
- [x] `MAX_AI_HTTP_RESPONSE_BYTES` の import が先頭ブロックに移動し re-export が維持される
- [x] `OpenAIProvider-branches.test.ts` と `httpTestFlow.test.ts` を含む既存テストと `npm run type-check` が green である

## テスト戦略
- 着手前に先行 parity テストを書く：`parseAndMapFetchError` の現行出力を golden pin する（401 / 403 / 404 / 429 / 5xx / Failed to fetch / フォールバック＋timeout / AbortError 分岐）。`testConnection` の fetch スロー時の現行ラベル出力も pin する
- 移行後に `describeHttpFailure` の parse プリセットへの委譲結果と golden の byte-identical を検証する
- lm-studio 設定での fetch スロー時ラベル検証テストと、Gemini / openai の既存挙動 pin テストを追加する
- 回帰の受け皿は `src/background/ai/providers/__tests__/` 配下の `OpenAIProvider-branches.test.ts` と `httpTestFlow.test.ts`（存在を読み取りで確認）とし、関連スイート全体と type-check で確認する

## 見積もり
1 pt（hooks 統一＋文言テーブルの委譲＋parity テスト先行の中規模変更。文言統一自体は別判断とする）

## 実装ガイド

### 作業順序（推奨）
1. 先行 parity テストを書く：`parseAndMapFetchError` の現行文言と `testConnection` の fetch スロー時の現行ラベル出力を golden pin する（この時点では実装に触らない）
2. `HttpTestHooks.fetchErrorLabel` を廃止し `providerLabel` に統一する（`HttpTestHooks` 定義、`executeHttpTestFlow` の catch 節、`OpenAIProvider` と `GeminiProvider` の hooks 渡しが対象）
3. `parseAndMapFetchError` の文言テーブルを `describeHttpFailure` の parse 経路プリセット（variant 引数等）に移し、委譲する。parity テストが green のままであることを確認する（byte-identical 移行）
4. `MAX_AI_HTTP_RESPONSE_BYTES` の import を先頭ブロックへ移動し re-export を維持する
5. 関連テスト全体と `npm run type-check` を実行して green を確認する

### 判断ポイント（明示的な変更として扱う）
- 第1テーブル（`describeHttpFailure` の既存プリセット）との文言統一（例：parse 経路 401 の `Invalid API key...` を `Authentication failed...` に揃える等）は byte-identical 移行の後に是非を判断する。着手順序は parity pin から意図的変更の順とし、無断で文言を変えない

### スコープ注意
- `executeHttpSummaryFlow` の catch 節の文言自体は本 PBI では変えない（fetch スロー時の汎用文言であり、ラベル埋め込みがないことを読み取りで確認）
- `mapConnectionError` 側の文言テーブルは変更しない（PBI 01 済み）
- `describeHttpFailure` の既存プリセット（Obsidian / GitHub 向け）の文言は byte-identical に保つ

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
