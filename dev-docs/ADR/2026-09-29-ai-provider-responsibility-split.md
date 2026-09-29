# AI プロバイダの責務境界: HTTP テンプレート・失敗写像・設定解決

## Status

- **Proposed**: 2026-09-29
- **Approved**: 2026-09-29
- **Implemented**: 2026-09-29 (PBI `pbi/2026-09-29-39-refactor-provider-strategy-responsibility-split.md`)

## Context

`src/background/ai/providers/ProviderStrategy.ts` は 632 行で 12 の責務を 1 ファイルに持っていた。3 つの不整合が重なっていた。

1. **`handleErrorResponse` が production 到達不能な必須フックだった。** interface の必須要素だったが、`fetchWithRetry` は non-ok 応答を必ず throw する（`src/utils/fetch.ts:380` の `throw attemptError` と、関数末尾の `throw lastError`）。したがって要約フローの `if (!response.ok)` 分岐には到達せず、`OpenAIProvider.ts` と `GeminiProvider.ts` にあった 2 つの実装はどちらも死んでいた。実装しないと型エラーになるのに、書いても誰も読まない — 新しいプロバイダに到達しない分岐の文面を書かせている。

2. **HTTP 失敗の写像が 3 系統に分かれていた。** 応答経路の `mapConnectionError`、throw 経路の `parseAndMapFetchError`（message の逆パース）、そして要約フロー catch の inline 分岐。timeout 判定は前 2 者でも一致しておらず、parse 経路は `AbortError` / `timed out` / `timeout`、要約フローは `AbortError` / `timed out` のみを見ていた。同じ transport 由来の失敗が、受け取ったフローによって別の kind になる可能性が残っていた。

3. **設定解決の優先順位が 3 箇所に手書きされていた。** timeout / 送信文字数 / max tokens の 3 つのラダーが、それぞれ自分の形で「per-provider → global → default」を書いていた。どれが意図された順序かはコードからは読めず、rung を 1 つ足すと片方だけがずれる構造だった。

さらに `shouldRetrySummaryRequest` は `src/utils/fetch.ts` の `defaultShouldRetry` と判断ロジックが同一なのに、要約フローだけが自前の述語を渡し、接続テストは transport の既定を継承していた。両者は 429 に対して同じ判断に到達するが、次の非互換の入口が開いていた。

## Decision

責務を「送信するか」で分割する。継承の段は名前ではなく到達範囲で決める。

- `ProviderStrategy.ts` — 送信手段に依存しない基底。設定の保持、名前と ID、schema 失敗と使用量計上という共有ポリシーだけを持つ。
- `HttpProviderStrategy.ts`（新規）— 2 つの HTTP フロー。`executeHttpSummaryFlow` / `executeHttpTestFlow` と、その順序が必要とする送信前ガード（`checkPreFlight` / `sanitizeContent` / `buildTestDebugBase` / 許可 URL 導出）。Gemini と OpenAI 互換はこれを継承する。
- `providerSettingsResolver.ts`（新規）— 設定解決の単一ラダー。`resolveProviderSetting` が「rung が値を返したら勝ち、返さなければ次」という順序だけを書き、3 つの設定はそこへ rung として載せる。rung が `undefined` を返した場合だけ次へ落ちるので、0 や NaN は「未設定」として扱われる。
- `src/utils/httpFailureMessages.ts` — HTTP 失敗の写像の総所在地。status から文面への表に加え、接続テストの封筒（`mapHttpConnectionFailure` / `mapHttpFetchFailure`）、timeout 判定（`isHttpTimeoutFailure`）、要約フローの失敗（`describeSummaryRequestFailure`）を持つ。Layer 0 のままで、依存するのは同为 Layer 0 の `failureTaxonomy` / `objectUtils` / `errorUtils` だけ。

個別判断:

- **`handleErrorResponse` は interface から削除する。** 到達経路を与えるのではなく消す。`fetchWithRetry` の契約が「ok で resolve する。故 non-ok は必ず throw」なので、分岐を消しても観測可能な挙動は変わらない。テンプレートには non-ok ガードを残すが、そこが返すのは provider 固有文面ではなく throw 経路と同じ汎用の 1 文である。そのガードは、transport が将来的に non-ok を resolve するようになったときエラー本文を要約として parse しないための保険であり、誰にも見せない文面を守るためのものである。
- **リトライ述語は provider 側で一切持たない。** `src/utils/fetch.ts` の述語が単一定義で、要約・接続テストとも既定を継承する。要約フローから `shouldRetry` を渡さないことで、「片方だけ述語を持つ」状態そのものを存在できなくした。
- **timeout 判定は広い方に揃える。** parse 経路の判定（`AbortError` / `timed out` / `timeout`）を要約フローにも適用する。狭める方を選ぶと `parseFetchErrorParity` の golden（`request timeout exceeded` が timeout 文面になる）が壊れるため採らない。

## Consequences

### Positive

- オンデバイスの `BuiltInAiProvider` は基底だけを継承するので、送信前ガードにも送信リトライにも構造的に手が届かない。かつて「pre-flight は意図的に飛ばす」とコメントで説明していた制約が、継承関係そのものになった。
- HTTP 失敗の文面と structured kind が同じファイルで同時に決まる。文面だけ差し替えて kind を残す、という取りこぼしが無くなる。
- 設定の優先順位が `resolveProviderSetting` の 1 箇所に書かれ、3 設定が同じ rung 集合を使う。
- parity テストが 3 プロバイダを 1 つの表で同じ形で検証できるようになった。4 つ目を足すときも表の形は変わらない。

### Negative

- プロバイダ実装は 2 段の継承（`AIProviderStrategy` → `HttpProviderStrategy`）を辿る。名前だけでは送信するか読み取れず、型で分かる形になる。
- `mapHttpConnectionFailure` / `mapHttpFetchFailure` はユーザー向けの文面を持つが `src/utils/` に住む。表（`describeHttpFailure`）が既に Layer 0 にあるためで、layer をまたいで AI 側へ移すより表のそばに置く方が正確と判断した。

### Residual risks

- **`isHttpTimeoutFailure` の和集合化は、transport 由来でない Error で観測できる差分を作る。** message に `timeout` を含む Error（例 `request timeout exceeded`）は、要約フローでは「汎用文 + 解決済みの kind」から「timeout 文」に変わる。production の transport は timeout を必ず `AbortError` 名 + `tagFailure(TIMEOUT)` 付きで投げる（`src/utils/fetch.ts:158-165`）ので到達しない。ただしこの判定は text sniff であり、Error を直接渡す外部呼び出し元があれば観測できる。retry 判断は structured kind しか読まない、という점은変わらない。
- **`!response.ok` ガードは到達不能のまま残る。** 存在目的は transport 契約が変わったときの破壊防止で、テストは「non-ok を渡しても parse されない」ことだけを固定する。transport が non-ok を resolve するようになったら、ガードと固定テストを合わせて見直す。
- **parity テストの表に 4 行目を足すには、送信しない provider について「送信しないこと」以外の主張を書くことになる。** 現表は `reachesTransport` で分岐する形で、その provider の契約は transport に触れないことだけになる。
- `src/messaging/messageTransport.ts` のコメントは削除した `ProviderStrategy.shouldRetrySummaryRequest` を参照したまま（別 effort の WIP 対象のため未編集）。
