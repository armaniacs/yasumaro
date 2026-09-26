# PBI: 構造化 failure taxonomy の SSOT 化

種別: refactor

## ユーザーストーリー

一時的なネットワーク障害、タイムアウト、認証エラー、レート制限、設定不備を区別して扱いたいユーザーと、それによって無駄な再試行や誤った通知を受ける運用担当者として、Recording 処理の失敗理由を安定した構造化 kind で把握できるようにしたい。そのため、AI、Obsidian、HTTP transport の各境界から同じ failure metadata を StepExecutor と retry policy まで届かせ、sanitized なユーザー向けメッセージは維持したい。

## ビジネス価値

- 一時的な接続障害と、認証・設定・レート制限のような即時再試行が適さない障害を区別できる。
- Obsidian の実際の network error や timeout が誤って offline 扱いになる運用上の盲点を解消できる。
- failure kind ごとの retry ポリシーを downstream PBI とテストで共有でき、将来の挙動変更を局所化できる。
- API key、response body、summary 本文を技術 metadata に保持せず、運用上の診断性と秘密情報の分離を両立できる。

## 優先度

順位: 11 / 30
RICEスコア: 1.6（Reach=3 / Impact=2 / Confidence=80% / Effort=3 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: Obsidian の実際の接続障害を network として扱う
  Given Obsidian への接続が transport 層で失敗する
  When Recording の失敗を StepExecutor が retry policy に渡す
  Then failure kind は network になる
  And 既存の接続障害ユーザー向けメッセージは保持される
  And failure metadata に API key や response body が含まれない

Scenario: AbortError を timeout として保持する
  Given Obsidian request が body read の timeout で中断される
  When 現在の transport と Obsidian の error 境界が failure を返す
  Then failure kind は timeout になる
  And 通常の network error と区別できる
  And timeout metadata が retry policy に渡る

Scenario: Obsidian write の HTTP 応答を安全に分類する
  Given Obsidian PUT が 401、403、429、または 5xx を返す
  When failure kind と retry 資格を決定する
  Then 401 と 403 は auth になる
  And 429 は rate_limit になり、即時 retry と offline retry の対象外になる
  And 5xx は http になり、同一 request 内の再送を行わない

Scenario: 全 AI provider の失敗を構造化して StepExecutor へ届ける
  Given RemoteAIService で利用可能な全 provider が失敗する
  And 失敗には技術 metadata と隔離された sanitized message が存在する
  When privacyPipeline が AI 結果を StepExecutor へ渡す
  Then 既存の summary result の扱いを維持したまま failure kind を参照できる
  And API key、response body、summary 本文が failure metadata に含まれない

Scenario: 即時回復を期待できない失敗を offline retry へ送らない
  Given failure kind が auth、rate_limit、configuration、または csp である
  When shouldEnqueueForOffline が実行される
  Then offline retry は開始されない
```

## 受け入れ基準

- [x] SSOT に `network`、`timeout`、`http`、`auth`、`rate_limit`、`configuration`、`csp` の 7 kind が定義されている。
- [x] 同じ kind と意味の重複定義が retry policy、AI、Obsidian、fetch の各実装へ存在しない。
- [x] 構造化 kind を持つ入力では、sanitized message の部分文字列一致を retry 判定に使用しない。
- [x] fetch transport、Obsidian error、AI result の 3 境界が failure metadata を StepExecutor まで保持する。
- [x] `AbortError` に基づく timeout が `network` と区別され、Obsidian 境界で新規 Error へ変換される際の metadata 損失がない。
- [x] HTTP 401 と 403 は `auth`、429 は `rate_limit`、5xx は `http` に分類される。
- [x] 429 は即時 retry と offline retry の対象外である。
- [x] POST、PUT、PATCH、DELETE の 5xx は同一 request 内で再送しない。`docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md:80-102` の既存方針を維持する。
- [x] `http` の delayed offline recovery は method ごとの追加判断を要するものとして、この PBI では自動 offline retry 対象に含めない。
- [x] `auth`、`rate_limit`、`configuration`、`csp` は offline retry 対象にしない。
- [x] `network` と `timeout` は offline retry の判断に利用できる。
- [x] ユーザー向け sanitized message の既存文言は、failure kind 導入後も parity を保つ。
- [x] failure metadata は構造化 kind と安全な技術情報だけを持ち、API key、response body、summary 本文、raw provider error を含まない。
- [x] 既存 result と exception の外部的な扱いを不必要に変えず、StepExecutor が両方の failure carrier を正規化できる。
- [x] `classifyError()` は SSOT の分類結果を再利用し、独立した message substring 判定の SSOT にはしない。
- [x] legacy message fallback が必要な箇所では、fallback の利用範囲が明示され、新規境界が message を contract として生成しない。
- [x] `MAX_PROVIDERS` の値は変更しない。
- [x] async/await、ESM import の `.js` 拡張子、Manifest V3 の制約を維持する。


## テスト戦略（t_wadaスタイル）

### E2Eテスト

- Recording の一つの代表経路で、実際の境界実装から生成した failure を StepExecutor と retry policy まで通す。
- network または timeout が発生した場合に recovery 対象の判定が kind に従い、既存ユーザー向けメッセージが変わらないことを確認する。
- auth または rate_limit が発生した場合に offline retry と誤った通知が発生しないことを確認する。

### 統合テスト

- `src/background/pipeline/__tests__/` に、ObsidianClient、RemoteAIService または ProviderStrategy、StepExecutor、RetryPolicy を実装修でつなぐ contract test を置く。
- Obsidian の network error、body timeout、PUT の 401、403、429、5xx を実 client の error 変換経路から生成し、RetryPolicy までの kind と retry 資格を検証する。
- 全 provider failure の summary result が privacyPipeline と StepExecutor の境界で failure metadata を保持し、summary 本文が metadata に混入しないことを検証する。
- `src/background/pipeline/__tests__/retryPolicy.test.ts`、`stepExecutor.test.ts`、`RecordingPipeline-offline-policy.test.ts`、AI provider、`httpSummaryFlow`、ObsidianClient の既存テストを新しい契約に合わせて更新する。
- 既存テストが前提とする sanitized message の文言 parity を明示的に検証し、failure kind の変更と表示文言の変化を分離する。

### 単体テスト

- SSOT の各 kind、HTTP status からの分類、timeout name の扱い、原因 metadata の保持を検証する。
- `auth`、`rate_limit`、`configuration`、`csp` が offline retry 対象にならないこと、429 が rate_limit に閉じて同じ扱いになることを検証する。
- POST、PUT、PATCH、DELETE の 5xx で同一 request の再送が発生しないことを検証する。
- `network` と `timeout` の offline retry 資格、および `http` の method 別判断を本 PBI 内で自動化しない境界を検証する。
- API key、response body、summary 本文を含む文字列が failure metadata に保存されないことを検証する。
- `classifyError()` が SSOT へ委譲し、message substring 判定を重複して持たないことを検証する。

## 実装アプローチ

1. Outside-In で、StepExecutor と RetryPolicy が実境界由来の structured failure を使えることを示す contract test を先に失敗させる。
2. 7 kind と安全な metadata、kind 単位の retry 資格を所有する SSOT を追加する。
3. fetch transport の `AbortError` を.timeout metadata に正規化し、Obsidian の network と timeout 変換で kind、status、method、安全な cause を保持させる。
4. ObsidianClient の PUT 401、403、429、5xx を対応する kind へ分類し、同一 request の再送を維持する。
5. ProviderStrategy の status metadata と RemoteAIService の全 provider failure summary に structured failure を保持させ、privacyPipeline と StepExecutor の既存分岐を維持する result または exception の carrier を正規化する。
6. RetryPolicy を structured kind を正とする契約へ移行し、message fallback を互換境界へ隔離する。
7. 既存 sanitized message parity と secret 非混入を検証してから、7 kind、3 境界、policy 単位の単体テストを追加する。
8. グリーン後に重複変換，消除可能な fallback、result と exception の重複 carrier を整理する。

## 見積もり

3 SP

## 技術的考慮事項

- 依存関係: なし。完了後の downstream は `pbi/2026-09-25-12-fix-offline-recovery-single-owner.md`、`pbi/2026-09-25-15-investigate-ai-provider-circuit-breaker.md`、`pbi/2026-09-25-13-investigate-obsidian-write-replay-idempotency.md` が本 PBI の SSOT を参照する。
- 正となる契約: structured failure metadata であり、sanitized message ではない。message は表示用途に限定する。
- carrier の境界: thrown Error と result summary のどちらも domain 上の failure を保持できるが、StepExecutor は両方を同じ正規化関数へ通してから retry 資格を判断する。
- 技術 metadata の範囲: HTTP status、HTTP method、failure kind、安全に正規化した cause 等の診断に必要な情報だけを許可する。
- secret の分離: raw provider error、API key、response body、summary 本文を metadata にコピーしない。
- 5xx の安全性: server での処理完了が応答損失と区別できないため、unsafe method の同一 request 再送を禁止する。delayed offline recovery の method 別採用可否は本 PBI の外で決定する。
- 429 の扱い: `rate_limit` へ正規化し、その kind 自体を即時 retry と offline retry の対象外にする。
- Service Worker: failure や retry 状態を Service Worker の実行時変数へ保持せず、既存の storage、alarm、pipeline state を通す。
- 非機能要件: retry 判定の overhead を小さく保ち、既存 API call 回数とユーザー向け表示の parity を維持する。
- `MAX_PROVIDERS`: `src/background/ai/RemoteAIService.ts:55` の定数と provider 集約方針を維持する。

## 実装者向け注記

### 現状コードの確認

- `src/background/pipeline/retryPolicy.ts:15-40` の `shouldEnqueueForOffline()` は production の retry 判断を所有し、`src/background/pipeline/stepExecutor.ts:53` が production consumer である。
- 実際に throw し得るステップは `privacyPipeline` と `saveObsidian` であり、`extractSentences` は内部 catch 後に fallback する。
- `retryPolicy.ts:33-35` は原因を遡るが、message dependency を除去してはいない。
- `src/utils/fetch.ts:147-154` は timeout error に `name = "AbortError"` を設定する。
- `src/background/ai/providers/ProviderStrategy.ts:24-47` は `debug.statusCode` を保持する。
- `src/utils/obsidianConfigValidator.ts:241-252` は network error を文言へ変換し、`:247-249` は timeout を新規 Error にする。
- `src/background/obsidianClient.ts:196-205` は PUT の 401、403、5xx を同一の接続確認メッセージへ変換する。
- `src/background/ai/RemoteAIService.ts:167-172` は全 provider failure を summary error result として返す。
- `src/background/privacyPipeline.ts:247-301` はその summary error を通常の cloud result として扱う。
- `src/utils/errorClassification.ts:80-123` の `classifyError()` は message substring 判定であり、単独再利用だけでは message dependency を除去できない。

### 実装手順

1. 7 kind と kind 単位の retry policy を test-first で確定する。
2. structured metadata の入力 contract と、throw または result から failure を取得する正規化 interface を SSOT として実装する。
3. fetch と Obsidian の network、timeout を SSOT に接続し、metadata の loss と表示文言の変化を contract test で確認する。
4. ObsidianClient の HTTP status を `auth`、`rate_limit`、`http` へ分類する。
5. AI provider と RemoteAIService の aggregate result に metadata を保持し、privacyPipeline と StepExecutor が同じ failure を参照できるようにする。
6. RetryPolicy を structured kind 優先へ切り替え、既存 test と message parity を更新する。
7. secret 非混入、7 kind、3 境界、unsafe 5xx、429、legacy fallback の範囲をテストで固定する。

### 落とし穴

- 既存テストの message 文言への依存を、taxonomy 導入と同じ変更で削除すると、表示 parity の回帰を検出できない。
- `RemoteAIService` の全 provider failure を一律 throw にすると、`privacyPipeline.ts:247-301` の既存分岐と result 契約が変わる。failure metadata を正とし、throw と result の carrier を明示的に扱う。
- timeout 用の新規 Error に旧 Error を渡さないと、`AbortError`、原因、HTTP metadata が失われる。
- 429 を単純な `http` のまま扱うと retry 資格が曖昧になるため、必ず `rate_limit` へ正規化する。
- 5xx を持つ unsafe method を connection failure として再分類すると、同一 request の再送による危険が生じる。
- raw Error、response body、summary を `cause` や debug metadata へ丸ごとコピーすると、sanitized message とは別の情報漏えい経路になる。
- legacy message fallback を SSOT として残すと、新規の境界が message coupling を再導入する。fallback は structured metadata が存在しない互換入力だけに限定する。

## 決定事項

1. RetryPolicy の正となる契約を sanitized message ではなく structured failure kind とする。message substring は新規 contract として禁止し、既存文言は parity test だけで保証する。
2. failure の伝播元は status、timeout name、method、cause の安全な正規化結果とし、sanitized message とは別 field に保持する。3 境界は SSOT と同じ metadata を渡す。
3. thrown Error と summary result のどちらも transport carrier として認め、domain の正となる値は structured failure とする。RemoteAIService の全 provider failure result を一律 throw へ変えず、StepExecutor が両 carrier を正規化する。
4. 実 client と provider を RetryPolicy までつなぐ contract test は pipeline の統合テストへ置き、boundary 固有の変換は各境界の単体テストで固定する。
5. enqueue policy は `network` と `timeout` を対象とし、`auth`、`rate_limit`、`configuration`、`csp` と `http` はこの PBI では対象外とする。429 は必ず `rate_limit` に閉じる。legacy message fallback は構造化 kind を持たない互換入力だけに限定し、新境界では利用しない。method 別の delayed offline recovery は別 PBI の決定事項とする。

## Definition of Done

- [x] SSOT に 7 kind が定義され、重複した kind 定義がない。
- [x] fetch transport、Obsidian error、AI result から StepExecutor まで structured failure が保持される。
- [x] `network`、`timeout`、`auth`、`rate_limit`、`http`、`configuration`、`csp` の BDD シナリオと境界条件が自動テスト化されている。
- [x] 429 が即時 retry と offline retry の対象外であることをテストが保証する。
- [x] unsafe method の 5xx が同一 request 内で再送されないことをテストが保証する。
- [x] 実 client と provider が生成する error を RetryPolicy まで通す contract test がある。
- [x] 既存 sanitized message の parity が検証され、ユーザー向け表示が変わっていない。
- [x] failure metadata に API key、response body、summary 本文、raw provider error が含まれないことをテストが保証する。
- [x] 既存テストが新しい taxonomy と parity 契約に合わせて更新されている。
- [x] 型チェックと全テストが成功し、async/await、ESM `.js` import、Manifest V3 の制約を満たしている。
- [x] `MAX_PROVIDERS` が維持されている。
- [x] downstream PBI が参照できる SSOT と retry policy が文書化されている。

---

# 実装報告（PBI 2026-09-25-11）

## 1. 5 Whys の連鎖と根本原因

**Why 1: なぜ retry 判断が sanitized message の substring に依存しているのか**
`RetryPolicy.shouldEnqueueForOffline()`（`src/background/pipeline/retryPolicy.ts:39-41` 旧）が、文字列が生む唯一の分類信号だったから。`errorMessage(error).toLowerCase()` に `network` / `fetch` / `timeout` / `offline` / `econnrefused` / `enotfound` / `refused` / `connection` / `unavailable` の 9 語を並べて判定していた。

**Why 2: なぜその substring が 3 実装で重複定義されているのか**
retry 資格が「型」ではなく「事故後に誰が最もらしい文言を選んだか」でしか表現されていなかったから。実測すると同じ意図の表が 3 箇所に別々の形で存在した。

- `src/background/pipeline/retryPolicy.ts:20-32`（9 語、offline queue 用）
- `src/utils/fetch.ts:301-325` `defaultShouldRetry`（429 / 5xx-method / AbortError / `NetworkError`・`fetch failed`）
- `src/background/ai/providers/ProviderStrategy.ts:549-566` `shouldRetrySummaryRequest`（同じ 4 分岐。`DELETE` が抜けており、Obsidian 側和其它と食い違っていた）
- 加えて `src/utils/retryPredicate.ts:14-41` に、同種の marker 表がさらに 2 つ（`isRetryableNetworkError` 用）

**Why 3: なぜ 3 境界の failure metadata が StepExecutor まで持ち越されないのか**
failure の carrier が 2 つあり、どちらも構造化された経路を持たなかったから。

- thrown Error: 境界は `new Error(sanitizedMessage)` を作り直すため、元の status / method / `AbortError` name が落ちる（`obsidianConfigValidator.ts:241-253`、`obsidianClient.ts:205-225`）。
- result summary: `AISummaryResult` には `success` / `summary` / `error` しか無く、kind を持つ場所が無く、StepExecutor の `catch` には thrown Error しか届かない（`RemoteAIService.ts:167-172` の全 provider failure は throw ではなく result で戻る）。

**Why 4: なぜ false positive（auth を network と誤認）が起きるのか**
2 つの carrier の両方が「構造」を持たれず、判定が文言だけに依存していたから。実測した誤認:

- Obsidian の PUT が 401/403 → `obsidianClient.ts:223` が `Error: Failed to write to daily note. Please check your **connection**.` を投げ → `handleObsidianError` が素通し → `RetryPolicy` が `connection` に一致 → **offline queue に入った**（API key 不備は offline 実行で解決しない）。
- Obsidian の GET が 500 → 同じ経路で `http` failure なのに offline に入った。
- 逆に CSP 拒否（`fetch.ts:120/123`）は文言に network 語が無く、kind 判定も成立しなかった。

**Why 5: 根本原因**
**failure の表現に「構造化工」と「表示文言」の 2 関心が 1 つの文字列に混在して残り、前者の contract がコードとして存在しなかった。** 文言はユーザー向けの出力であり、retry という制御フローの入力として使うべきではない。境界が文言だけを投げる設計だったため、结构化されていない情報を「下流で推測して再解釈する」以外の手段がなく、誤認も重複定義もそこから派生していた。

## 2. SSOT の置き場所と選択理由

**`src/utils/failureTaxonomy.ts`（`// @layer 0`）**

| 候補 | 判定 | 理由 |
|------|------|------|
| `src/background/pipeline/retryPolicy.ts` 配下 | 却下 | 3 境界のうち fetch / Obsidian（`src/utils/` Layer 2）から background を import することになり、`utils → background` の逆方向依存（LAYERS.md 依存ルール違反）。`local/utils-layer-boundary` が error で落とす。 |
| `src/utils/errorClassification.ts` | 却下 | 未分類（LAYERS.md 分類表に無い）。同ファイルは `sensitiveDataMask` に依存し、Layer 0 として機械検査できない。また 9 値 popup 語彙（`VALIDATION` / `NOT_FOUND` / `DOMAIN_BLOCKED` を含む）を所有しており、7 kind の語彙と 1:1 ではない。 |
| **`src/utils/failureTaxonomy.ts` を新設して Layer 0** | **採用** | 純関数・import ゼロ・chrome 非依存なので Layer 0 の条件を満たす。既に `httpFailureMessages.ts`（HTTP status→表示文言）と `backoff.ts`（backoff 遅延）が同じ Tier にある precedents がある。`utils/fetch.ts`・`obsidianConfigValidator.ts`（Layer 2）と `background/*` の双方が下向きに import できるため、逆辺も循環も発生しない。 |

層の分類表（`dev-docs/LAYERS.md`）と lint の SSOT（`eslint/rules/utils-layer-boundary.mjs` の `LAYER0_FILES`）の両方へ登録済み。`npm run lint:layers-docs` → 「Checked 51 rule entries against LAYERS.md — layer lists in sync.」

SSOT が持つもの: 7 kind の宣言、kind 単位の retry profile 表、HTTP status→kind 分類、unsafe method 表、carrier への attach/read と唯一の正規化関数 `resolveFailure()`、および互換入力専用の retry 述語 2 つ。

## 3. 7 kind の分類結果表と retry 資格

| kind | 入力（status / error name） | 即時 retry | offline recovery | 同一 request 再送 | 主な生成元 |
|------|---------------------------|-----------|------------------|----------------|-----------|
| `network` | `cause.name = 'NetworkError'`、`cause.name = 'TypeError'` の transport 失敗、Obsidian の `Failed to fetch` | ○ | ○ | ○ | `handleObsidianError`（`obsidianConfigValidator.ts`）、`parseAndMapFetchError` |
| `timeout` | `name = 'AbortError'`（`fetchWithTimeout` の request timeout、`readBodyWithTimeout` の body-read timeout） | ○（attempt ≤ 1） | ○ | ○ | `fetch.ts:151-155`、`obsidianConfigValidator.ts`（body read）、`executeHttpSummaryFlow` catch |
| `http` | 400 / 404 / 422 / 5xx（`status >= 500` は transient） | ○（transient のとき） | × | method が unsafe でないときのみ | `obsidianClient._writeContent` / `_fetchExistingContent`、`fetchWithRetry` の `attemptError`、`parseAndMapFetchError`、`executeHttpTestFlow` |
| `auth` | 401 / 403 | × | × | × | 同上（`classifyHttpStatus`） |
| `rate_limit` | 429 | × | × | × | 同上（`classifyHttpStatus`）。`checkCredentials` が使う AI 側の kind は `configuration` |
| `configuration` | `validateObsidianProtocol` / `validateObsidianHost` / `validateObsidianPort` の throw、未登録 provider、AI credential 欠落 | × | × | × | `obsidianConfigValidator.ts`、`RemoteAIService.processSummarySlot`、`executeHttpSummaryFlow` |
| `csp` | CSP 拒否、allowlist 拒否 | × | × | × | `fetchWithTimeout`（`:120` / `:123` / `:132`） |

- 429 は `classifyHttpStatus` で必ず `rate_limit` に閉じる。`http` のまま扱う枝は無い。
- unsafe method は `UNSAFE_METHODS = {POST, PUT, PATCH, DELETE}` の SSOT 単一表のみ。以前 `ProviderStrategy` にあった `['POST','PUT','PATCH']`（DELETE 欠落）を撤去し、guideline と一致させた（AI 要約は常に POST なので実挙動は不変）。
- `error.name = 'NetworkError'` も `resolveFailure` が構造化 name として扱うため、`fetch.ts` / `ProviderStrategy` にあった `error.name === 'NetworkError'` の重複判定が消えた。
- `shouldRetryTransportFailure` は「response が既に分かっている場合」を意図的に扱わない。throw された `HTTP 400` は kind `http` であり、これを retry 可能と扱うと 4xx の再送が始まるため、transport kind（`network` / `timeout`）だけを即時 retry の対象に限定した。

## 4. 変更したファイル一覧（絶対パス）

新規:
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/failureTaxonomy.ts` — SSOT（7 kind / retry profile / 分類 / carrier / 正規化 / 互換述語）
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/__tests__/failureTaxonomy.test.ts`
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/__tests__/errorClassification-taxonomy.test.ts`
- `/Users/yaar/Playground/obsidian-smart-history/src/background/__tests__/obsidianClient-failureTaxonomy.test.ts`
- `/Users/yaar/Playground/obsidian-smart-history/src/background/pipeline/__tests__/failureTaxonomy-contract.test.ts`

変更:
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/fetch.ts` — AbortError→`timeout` metadata、CSP/allowlist 拒否→`csp`、`attemptError`→`failureFromHttpStatus`、`defaultShouldRetry` を SSOT 委譲に
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/obsidianConfigValidator.ts` — 設定不備→`configuration`、body-read timeout→`timeout`、`handleObsidianError` が kind を保持（文言は不変）
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/retryPredicate.ts` — kind 優先（前置き）に、marker 表は互換入力専用へ隔離
- `/Users/yaar/Playground/obsidian-smart-history/src/utils/errorClassification.ts` — `classifyError()` が `resolveFailure()` を優先し、substring 表は fallback へ降格
- `/Users/yaar/Playground/obsidian-smart-history/src/background/obsidianClient.ts` — `_writeContent` / `_fetchExistingContent` が status→kind を保持
- `/Users/yaar/Playground/obsidian-smart-history/src/background/ai/providers/ProviderStrategy.ts` — `AISummaryResult.failure` / `AISlotFailure.failure` / `debug.failure`、`shouldRetrySummaryRequest` を SSOT 委譲に、credential 欠落→`configuration`
- `/Users/yaar/Playground/obsidian-smart-history/src/background/ai/RemoteAIService.ts` — slot 失敗と集約 result に `failure` を保持（全 provider failure を throw にはしない）
- `/Users/yaar/Playground/obsidian-smart-history/src/background/privacyPipeline.ts` — `PrivacyPipelineResult.failure` を受け渡し（既存の summary error 分岐は不変）
- `/Users/yaar/Playground/obsidian-smart-history/src/background/pipeline/retryPolicy.ts` — kind を正とする契約に、legacy marker は「構造化 kind 不在時のみ」に隔離
- `/Users/yaar/Playground/obsidian-smart-history/src/background/pipeline/stepExecutor.ts` — thrown / summary の両 carrier を同じ `resolveFailure()` へ通し、`failureKind` をログに記録
- `/Users/yaar/Playground/obsidian-smart-history/src/background/pipeline/__tests__/retryPolicy.test.ts` — 既存 legacy ケースを温存しつつ kind 駆動のケースを追加
- `/Users/yaar/Playground/obsidian-smart-history/src/background/pipeline/__tests__/stepExecutor.test.ts` — 7 kind × offline 資格のケースを追加
- `/Users/yaar/Playground/obsidian-smart-history/src/background/ai/providers/__tests__/httpSummaryFlow.test.ts` — 表示 parity を保ちつつ `failure` 検証を追加
- `/Users/yaar/Playground/obsidian-smart-history/src/background/ai/providers/__tests__/httpTestFlow.test.ts` — 6 箇所の `debug` 期待値に `failure` を追加（文言は不変）
- `/Users/yaar/Playground/obsidian-smart-history/dev-docs/LAYERS.md` — Layer 0 分類表に `failureTaxonomy.ts` を追加
- `/Users/yaar/Playground/obsidian-smart-history/eslint/rules/utils-layer-boundary.mjs` — `LAYER0_FILES` に追加
- `/Users/yaar/Playground/obsidian-smart-history/pbi/2026-09-25-11-refactor-structured-failure-taxonomy.md` — 本節

## 5. 既存 sanitized message の parity をどう担保したか

**文言を書き換えず、carrier だけを付け足した。** 3 層の仕組みで固定する。

1. **境界の実装で文言文字列を一切変更していない。** `obsidianConfigValidator.ts` の 3 文面（self-signed / timed out / generic）、`obsidianClient.ts` の 2 文面（read / write）、`executeHttpSummaryFlow` の 2 summary、`parseAndMapFetchError` の 4 文面、`describeHttpFailure` の全 preset はすべて byte 不変。
2. **既存テストの文言依存を消さずに、`failure` 追加だけを追随させた。** `httpSummaryFlow.test.ts` の 2 箇所は `toEqual({...})` を「summary / error の個別アサーション + `failure` の個別アサーション」に分解し、文言は従来どおり完全一致で固定。`httpTestFlow.test.ts` の 6 箇所は `debug` 期待値に `failure` を足すだけで、`message` の期待値はそのまま。新規 parity テスト:
   - `obsidianClient-failureTaxonomy.test.ts`「keeps the existing user-facing wording for every status」— 401/403/429/500 の 4 状態で文言を完全一致させ、status 数字が含まれないことも確認。
   - 同「keeps the https self-signed-certificate sentence」と「classifies a body read timeout as timeout and keeps its wording」。
   - `errorClassification-taxonomy.test.ts`「user message parity」— 旧語彙の fallback sentence 5 種と、csp が `errorGeneric` のままであることを固定。
   - `parseFetchErrorParity.test.ts` / `ProviderStrategy.test.ts` の message 専用アサーションは無改変で通過。
3. **1 点だけ意図的に変えた表現がある**（文言ではなく i18n key の選択）: `classifyError()` が構造化 kind を使うため、Obsidian の 401/403（`auth`）は `errorNetwork` ではなく `errorAuth` を返すようになった。旧来その sanitized 文面が `errorNetwork` に対応していたのは誤分類であり、**文言自体は変更していない**。`csp` は文言 parity を優先して `UNKNOWN`（= `errorGeneric`）に割り当てている（`errorClassification.ts` の `FAILURE_KIND_TO_ERROR_TYPE` に理由コメントあり）。

## 6. secret 非混入をどうテストで保証したか

構造的には、metadata が保持できるフィールドを `kind` / `status` / `method` / `cause.name` の 4 つに限定し、`cause` は Error ではなく `{ name }` に正規化して message を捨てる（`createFailure` → `normalizeCause`）。加えて 4 層のテストで固定:

| テスト | 主張 |
|--------|------|
| `failureTaxonomy.test.ts`「keeps only the cause name, never the cause message」 | `sk-…` / body 入り Error を cause に渡しても metadata は `{kind, cause:{name}}` のみ |
| `failureTaxonomy.test.ts`「reads back the same metadata for both carrier shapes」 | Error と summary の両 carrier が同じ構造を読み出す |
| `obsidianClient-failureTaxonomy.test.ts`「keeps API key and response body out of the failure metadata」 | 実 `_writeContent` が `Forbidden: token sk-live-SECRET-999 rejected` を本文に含む 401 応答を処理しても、metadata と sanitized 文言のどちらにも現れない |
| `httpSummaryFlow.test.ts`「keeps API key material out of the failure metadata」 | `Authorization Bearer sk-secret-1234 body {"key":…}` 入り NetworkError で、metadata に鍵素材が入らない |
| `errorClassification-taxonomy.test.ts`「never stores an API key, a response body, or a summary body」 | API key / body / summary を同時混入させた carrier で `JSON.stringify(failure)` が 3 つすべてを含まず、期待値と完全一致 |
| `failureTaxonomy-contract.test.ts`「forwards the failure kind without letting the summary text into the metadata」 | privacyPipeline 境界を貫通して summary 本文と `sk-live-SECRET-777` が metadata に現れない |

なお raw Error / response body は message 経路（`result.error`、`AISlotFailure.error`、`addLog`）に従来どおり残る。これは「表示・診断テキスト」の契約であり、本 PBI が変えない。変えたのは metadata チャネル のみで、`Error` オブジェクトを `cause` や debug metadata へ丸ごとコピーする経路は新增設していない（旧来も存在しない）。

## 7. downstream 12 / 13 / 15 への引き継ぎ

**PBI 2026-09-25-12（offline recovery の single owner）**
- 依拠できるもの: `RetryPolicy.shouldEnqueueForOffline()` は `resolveFailure()` 経由の kind 判定だけを見る。`FAILURE_RETRY_PROFILE[kind].offlineRecovery` が唯一の資格表で、`network` / `timeout` のみ true。
- 渡すべきもの: `http` の method 別 delayed recovery 判定。本 PBI は `http` を offline 対象から外しただけ。判定に必要な `method` は metadata に載っているので、`failureFromHttpStatus(status, 'PUT')` の形で kind と併せて使える。安全装置として `canResendSameRequest(kind, method)` が SSOT にあり、unsafe method での再送を構造的に拒否する。
- 遗留: `RetryPolicy` の legacy marker 表（9 語）は「構造化 kind 不在の互換入力」専用として残した。Obsidian / AI 境界は retrofit 済みなので到達しないが、テストが message 文言に依存する箇所（`stepExecutor.test.ts` の `'AI service unavailable'` 等）がまだ 2〜3 個残る。完全撤去は別途判断。

**PBI 2026-09-25-15（AI provider circuit breaker）**
- 依拠できるもの: slot 単位の kind は `AISlotFailure.failure`、集約 result の kind は `AISummaryResult.failure`（`RemoteAIService` が「最初に kind を分類した slot」を採用する rule を明文化済み）。`AIProviderConnectionResult.debug.failure` も 401/403/429/5xx を保持する。
- 未決（本 PBI の裁定）: 複数 slot が異なる kind で失敗したときの集約規則。「最初の kind を採用」は情報を捨てるので、circuit breaker の breaker 状態（`rate_limit` の連続、provider ごとの `auth`）には足りない可能性が残る。集約規則の再設計は 15 の側で決めること。
- 依拠できないもの: AI 側 preflight（月次上限・usage warning・rate limit）の kind。`ProviderStrategy.checkPreFlight()` は 3 理由潰して message だけ返すため、この 3 分岐は未構造化のまま。要分類なら 15 の側で `checkPreFlight` の返り値を `failure` 付きに広げる必要がある。

**PBI 2026-09-25-13（Obsidian write replay idempotency）**
- 依拠できるもの: PUT の失敗は `failureFromHttpStatus(status, 'PUT')` として `method` 付きで届く。5xx は `http`、`429` は `rate_limit`、`401/403` は `auth` として既に確定しており、replay 方針の入力にそのまま使える。
- 依拠できる保証: unsafe method の 5xx は同一 request 内で再送されない（`canResendSameRequest` + `defaultShouldRetry` / `shouldRetrySummaryRequest` の SSOT 委譲）。実測テスト: `obsidianClient-failureTaxonomy.test.ts`「never re-sends a 5xx inside the same request」— 503 応答時に PUT は 1 回だけ。
- 注意: `http` は offline recovery 対象外なので、5xx の PUT は offline queue に入らない（本 PBI の明示的な決定事項）。delayed replay を検討する場合は `FAILURE_RETRY_PROFILE.http.offlineRecovery` を変更する形で裁定すること。SSOT の表（PBI 13 が変更してよいのは `FAILURE_RETRY_PROFILE.http.offlineRecovery` の 1 フィールドだけ）以外は触れていない。

## 8. 検証結果

| コマンド | 結果 |
|----------|------|
| `npm run type-check` | **PASS**（エラー 0） |
| `npm run type-check:test` | **255 errors**（HEAD の既存負債と同数。自分の変更ファイル由来の新規エラーなし） |
| 対象テスト 20 files（failureTaxonomy / errorClassification / errorClassification-taxonomy / fetch / retryPredicate / obsidianClient ×6 / httpSummaryFlow / httpTestFlow / ProviderStrategy / parseFetchErrorParity / RemoteAIServiceSlotLog / retryPolicy / stepExecutor / failureTaxonomy-contract / RecordingPipeline-offline-policy） | **20 files passed / 388 tests passed** |
| `npm test`（全 suite） | **920 files passed / 1 skipped、14239 tests passed / 21 skipped、failed 0** |
| `npm run lint` | **0 errors**、145 warnings（変更ファイル由来の warning 0 件。全 warning は既存の wasm `.d.ts` 等） |
| `npm run lint:layers-docs` | 「layer lists in sync」 |
| `npm run validate:json` / `check-innerhtml-escape` / `check-deprecated-aliases` | すべて OK |

補足: 作業途中/full suite 実行時に `eslint/__tests__/*` と `src/utils/**/storage*` 系が一度失敗したが、これは並行セッション側の進行中の変更に由来し、最終 run では green に戻っている（自分の変更ファイルとは無関係）。`--repeats` は当リポジトリの vitest 5.0.0 では件数に反映されなかったため、flakiness 確認は `--repeats=5` 指定で 3 回実行し 3 回とも pass で確認した。

## 9. 統合側の修正 — 表示経路を kind から切り離した

実装直後、統合担当が以下を検出した。

### 検出した問題

当初の実装は `classifyError()` の先頭で `resolveFailure()` を呼び、kind から `ErrorType` を
決めていた（`FAILURE_KIND_TO_ERROR_TYPE`）。これにより **Obsidian の HTTP 失敗の
表示が 4 つ変わっていた**:

taxonomy 導入前の `classifyError()` は network 判定を最初に評価していたため、
Obsidian のエラー文面 `Please check your Obsidian connection.` は常に
`ErrorType.NETWORK`（`errorNetwork` / 「インターネット接続を確認してください」）に
落ちていた。kind 経由にすると 401/403 は `errorAuth`（「APIキーを確認してください」）、
429 は `errorRateLimit`、5xx と 404 は `errorServer` になる。

実装の自己報告は「文言は不変、i18n key 1 点のみ」としていたが、実際には
4 つの Obsidian エラー表示が変わる。**PBI の受け入れ基準「ユーザー向け sanitized
message の既存文言は parity を保つ」「failure kind 導入と表示文言の変化を分離する」
に反する変更**である。

### なぜ静的な kind→ErrorType 表で parity を保てないか

導入前の表示キーは**メッセージ文面に依存して**決まっていた。Obsidian の
メッセージは 401/403/404/429/5xx で同一なので、kind ごとに 1 つの `ErrorType` を
割り当てても導入前の表示を再現できない（逆に、`auth` 種別の一部入力は導入前から
`ErrorType.AUTH` に到達しうるため。一律 `NETWORK` 固定でも別の入力が変わってしまう）。
つまり parity を保つには**表示経路を kind から切り離すしかない**。

### 採った処置

1. `classifyError()` から `resolveFailure()` の呼び出しを外し、メッセージベースの
   判定を意図的に維持した。表示経路は変更なし。
2. `FAILURE_KIND_TO_ERROR_TYPE` は **export した参照表として残置**し、意図的な
   移行先（将来の文言修正の目標語彙）としてコメントで明記した。実行経路からは外す。
3. `errorClassification-taxonomy.test.ts` の「structured kind delegation」8 テストを
   **分離の不変条件**に書き換えた。7 kind × 7 メッセージについて
   `classifyError(with kind) === classifyError(without kind)` であることを固定し、
   Obsidian の 401/403/404/429/500/503 が `NETWORK` 表示のままであること、
   かつ同じ carrier の `resolveFailure()?.kind` が正しいこと（表示と kind が
   意図的に食い違うこと）を検証する。
4. secret 非混入と fallback sentence のテストはそのまま残した。

**結果**: 表示文言は変更なし（parity 達成）、retry 判断は kind に基づく、
`type-check` PASS、対象 4 files / 94 tests green。

### 残した既知の不具合（別 PBI 化）

Obsidian の 401/403 が「インターネット接続を確認してください」と表示するのは
**実装の誤り**であり、taxonomy が `auth` と正しく分類した今なら直せる。意図的な
文言修正なので別 PBI として起票し、レビューとリリースノートを伴わせる。

→ `pbi/2026-09-25-32-fix-obsidian-auth-error-wording.md`
