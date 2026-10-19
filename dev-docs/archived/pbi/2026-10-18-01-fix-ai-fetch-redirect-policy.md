# PBI: AI 要約・接続テストのリクエストをリダイレクトで転送させせない（redirect 方針の適用）

## ユーザーストーリー
拡張機能の利用者として、AI プロバイダへ要約リクエストや接続確認を送る際、許可したプロバイダが 30x を返しても、その応答がそのまま別の宛先（自分の端末の内部アドレスを含めて）へ転送されて、API キーやページの本文が自分が設定した相手でない場所へ送られないようにしたい。資格情報は自分で登録したプロバイダにだけ渡したいからである。

## 優先度
- 順位: 01 / 25
- RICEスコア: 16800（Reach=700 / Impact=3 / Confidence=80% / Effort=0.1）
- 根拠: 監査25リード中RICE最上位。Credential（Authorization Bearer / x-goog-api-key）とページ由来のプロンプト内容が、事前ホップ検査だけを通過した allow-list プロバイダ origin から未検証アドレス（loopback/internal含む）へ 30x で転送されうる。リポジトリ自身の ADR が FETCH_URL 経路では同じ穴を redirect:'error' で塞いでいるのに対し、AI 経路は未対応。修正は1箇所のオプション追加で済み工数が最小。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（既知プロバイダがリダイレクトに依存していれば要約結果が変わるため、検証計画とロールバックを明記）

## 背景（監査の出典）
security-audit run-2（source ref d49d70a3）の needs_validation リード。fingerprint: `f1be34a51b1912bc2c7cf49b59b7d444a32dc9e864513c886ac96b24c295d195`。confirmed ではなく needs_validation（ブロッカーは実装前に解消すべき検証事項）。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/

一言でいうと、今の設定では「許可したプロバイダが 30x を返す」だけで、その Location が指す場所（ネットワーク内の端末や自分の PC のループバックポート）に API キーとページ本文が届きうる。許可済みのプロバイダが 4 つの入口（URL 検証 / CSP / allowedUrls / origin 認証）を通過したあとで送信するだけで、転送先に対する検証がどこにもない。

## BDD受け入れシナリオ

```gherkin
Scenario: 許可済みプロバイダが 30x を返してもループバックへは届かない（エラー/境界ケース）
  Given ユーザーが API キーを登録した許可済みプロバイダ（例: https://api.example.com）が設定されている
  And プロバイダが 307 を返し、Location が http://127.0.0.1:27124 を指している
  When ユーザーがそのページの要約を生成する
  Then 要約は生成されず、失敗メッセージが表示される
  And 127.0.0.1:27124 へのリクエストは一切発行されない
  And 発行されるリクエストは、許可済みプロバイダの URL だけである
  And どこにも Authorization ヘッダー付きの転送先リクエストが残らない

Scenario: 応答が 200 なら従来どおり要約できる（ハッピーパス）
  Given 許可済みプロバイダが、要約用の JSON を 200 で返す
  When ユーザーが要約を生成する
  Then リクエストは許可済みプロバイダへ 1 回だけ送られ、リダイレクト設定は修正前と変わらない
  And 要約本文が従来どおり生成・保存される
  And 接続テストも従来どおり成功を返す

Scenario: 接続テストも同じ方針で拒否する（入口の対称性）
  Given 許可済みプロバイダの接続確認が 302 を返し、Location が未検証の外部ホストを指している
  When ユーザーが設定画面で接続確認を実行する
  Then 接続確認は成功を返さず、失敗理由として接続エラーとして表示される
  And 未検証のホストへのリクエストは発行されない

Scenario: 正当な http→https 昇格も今回は拒否される（トレードオフの明示）
  Given 許可済みプロバイダが 301 を返し、Location が同一ホストの https URL を指している
  When ユーザーが要約を生成する
  Then この場合も転送は行われず、失敗として扱われる
  And この判断が ADR に記録され、正当なリダイレクトが必要になった場合の復帰手順が書かれている
```

シナリオ 1〜3 は `src/utils/__tests__/` の既存規約（vitest / `environment: 'node'` / `testDir/vitest.setup.ts` のグローバル chrome mock / `vi.stubGlobal('fetch', fetchMock)` と `makeResponse` ヘルパー、`beforeEach` の `installTestSecretKek()`）でそのまま実行できる。

## 受け入れ基準
- [x] 許可済みプロバイダが 30x を返したとき、転送先（Location 解決後の URL）へリクエストが発行されないことが、単体テストで確認できる
- [x] 30x の応答は要約を生成せず、既存の失敗メッセージ（ユーザーには汎用の要約失敗として）で終わる
- [x] 転送先として loopback（`http://127.0.0.1:27124` のようなローカル AI ポートを含む）だけでなく private IP を伴う Location でも同様に拒否される
- [x] 許可済みプロバイダが 200 を返す通常経路では、リクエスト回数・ヘッダー・生成される要約が修正前と同一である
- [x] 接続テスト経路（`executeHttpTestFlow`）にも同じ方針が適用されている
- [x] ローカル AI（Ollama / LM Studio の許可ポート）への直接リクエストは引き続き成功する（許可ポートのループバックは拒否対象にしない）
- [x] AI 経路のリダイレクト方針が ADR 2026-08-29 に追記され、「他の fetch 経路は固定ホスト」という誤った記述が訂正されている
- [x] `npm run validate`（type-check + test）が緑

## テスト戦略
- 単体: `src/utils/fetch.ts` の境界値と分岐（`redirect` オプションが 200 経路を壊さないこと、3xx で送りが起きないこと、Location 欠落・相対 Location のような境界が安全側で落ちること）、`redirect: 'error'` 起因の失敗が既存のリトライ判定（`shouldRetryTransportFailure`）で何回再送されるかの確認。既存ファイル `src/utils/__tests__/fetchRedirectGuard.test.ts` の `makeResponse` ヘルパーの形式を再利用して、`src/utils/__tests__/fetch.test.ts` に AI 経路のケースを追加する。
- 統合: `fetchWithRetry` → `fetchWithTimeout` の連携。`HttpProviderStrategy.test.ts`（`src/background/ai/providers/__tests__/`）側で、許可済みプロバイダが 307 を返す状況を再現し、`executeHttpSummaryFlow` が要約を返さず、発行された fetch URL が許可済みプロバイダの 1 件だけであることを確認する。
- E2E: 不要（サービスワーカー内部の送信ポリシーの変更であり、受け入れ確認は統合テストで足りる）。

## 実装メモ（実装者向け）

### 対象ファイルと該当行
- `src/background/ai/providers/HttpProviderStrategy.ts:245`（`executeHttpSummaryFlow`）と `:313`（`executeHttpTestFlow`）— `fetchWithRetry` に `redirect` オプションを渡していない（監査 evidence）。
- `src/utils/fetch.ts:155` — プラットフォーム `fetch` に `redirect` オプションがなく、既定の `redirect: 'follow'` が効く（監査 sink）。
- `src/utils/fetch.ts:380` — `fetchWithRetry` が各試行で呼び出し側のオプションをそのまま `fetchWithTimeout` に渡す（ Options の追加がそのまま伝わる場所）。
- `src/utils/fetch.ts:128` — 事前ホップのゲート（CSP / allowedUrls）が初回 URL しか見ない。
- `src/background/handlers/systemHandlers.ts:101-112` — 既存の正解例（フィルタリスト経路は `redirect: 'error'` + `response.redirected` の body ガード）。
- `src/utils/fetch.ts:201-242`（`fetchWithRedirectGuard`）— ホップ毎再検証ヘルパー。production 呼び出し元はまだない。
- `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md:46` — 「他の 16 の fetch サイトは固定ホストで挙動不変」という記述が、OpenAI 互換行の `baseUrlKey` がユーザー設定可能（`src/utils/storage/providerAllowlist.ts`、`src/background/ai/providers/OpenAIProvider.ts:69-73`）であるために誤り。

### 最小変更の選択肢
**A. `redirect: 'error'` を AI 経路の fetch オプションに追加する（推奨、最小）**
- 変更箇所は `HttpProviderStrategy.ts` の 2 箇所のオプションオブジェクトのみ（または共通化箇所）。
- 副作用: 既知プロバイダがリダイレクトに依存している場合、正当な 200 が得られず要約が失敗する。実運用では Gemini / OpenAI 互換の主要エンドポイントは固定 HTTPS なので影響は限定的だが、検証計画（下記）で確認する。
- 副次的な副作用: `redirect: 'error'` の拒否は transport failure として届くため、共有リトライ方針（`fetchWithRetry` の `maxRetryCount`）で再送されうる。再送しても安全側（転送は起きない）だが、回数だけ確認しておく。

**B. AI 経路を `fetchWithRedirectGuard` に統一する（ホップ毎に `validateUrlForAIRequests` で再検証）**
- 副作用: 現状の `fetchWithRedirectGuard` は `skipCspValidation: true` を強制し、再検証に `validateUrlForFilterImport` を使う。AI 経路ではローカル AI の許可ポート（Ollama / LM Studio）を正当に許可したいので、そのまま流すとローカル AI が落ちる。検証器を引数化的（既定は `validateUrlForFilterImport`、AI 経路は `validateUrlForAIRequests`）する変更が前提になる。
- 工数: A より大きく、ホップ毎検証器の引数化が必要になる。PBI 08（ssrf-guard の Obsidian 経路）と統合実装する場合に初めて検討価値が見えてくるので、単独では推奨しない。

**推奨**: A を採用し、既定の安全方針を `src/utils/fetch.ts` の AI 経路側に置く。PBI 08 と共通化する場合は、`redirect:'error'` の追加が両者共通の買い点になることを実装時に確認する。

### ブロッカー（needs_validation の未解決事項）— 着手前に潰すべき検証
1. **ブラウザの実挙動（owner 確認）**: クロスオリジンリダイレクトでブラウザが Authorization / x-goog-api-key を除去するか、転送先が CORS 読み取り可能か（Chromium / Edge / Firefox）。これが「credential・prompt・response のどれがリダイレクトを越えるか」を決める。ローカルのモックテストだけでは決着しない。
2. **修正方針の確定（owner 判断）**: A（`redirect:'error'`）か B（`fetchWithRedirectGuard` 統一）か。A を採用する場合でも、理由（既知プロバイダはリダイレクトに依存しない）を ADR に残す。
3. **E2E フィクスチャ**: 許可済みプロバイダ origin から `http://127.0.0.1:27124` への 307 をモックし、要約が生成されずループバックリクエストも出ないことを確認する。

### ロールバック手順
- 変更はオプション 1 行（＋テスト）に閉じているため、`redirect` オプションの削除とテストの revert で即座に戻せる。
- ロールバックの判断基準: 本番で「許可済みプロバイダの要約が一律に失敗する」報告が 2 件以上出た場合、`redirect: 'error'` を外して `fetchWithRedirectGuard` 方式（B）へ切り替える。ただしその場合もループバックへの転送を防ぐよう、ホップ毎検証を必ず残すこと。

## 見積もり
1 ストーリーポイント（要チームで見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] npm run validate（type-check + test）が緑
- [x] 監査レコード fingerprint を本PBIの完了記録に残す
- [x] コードレビュー完了（独立レビュー。正確性・セキュリティの指摘なし。残った指摘は下表の残存リスクへ記録）
- [x] ドキュメント更新済み（ADR 2026-08-29 の「他のfetch経路は固定ホスト」という記述が誤りである点を更新）

## 調査結果（2026-10-18）

- 判定: 構造確定（`redirect` オプション未適用）／仕様確定
- 決め手: Fetch 仕様により、クロスオリジンリダイレクトで Authorization は 3 エンジンとも剥がれるが、**`x-goog-api-key` は剥がれない**（CORS non-wildcard request-header は Authorization のみ）。307/308 は本文を保持し、CORS-unsafe ヘッダ付きなら preflight が先行するため、転送先が応答しない限り実リクエストは発行されない
- 影響: Gemini 経路は重大度維持（API キー値と本文が転送先へ届きうる）、Bearer 経路は条件付き。`redirect:'error'` は依然として正しい最小修正。**Impact 3→2、RICE 16800→11200**

## 完了記録（2026-10-19）

- **判定**: 修正完了（PBI 08 と together 実装）。AI 経路の `fetchWithRetry` は `redirect:'error'` を明示し、platform 既定の `follow` に依存しない。
- **実装**: `src/utils/fetch.ts` に共通 seam `NO_REDIRECT_FETCH_POLICY = { redirect: 'error' } as const` を追加し、`HttpProviderStrategy.ts` の `executeHttpSummaryFlow` / `executeHttpTestFlow` の `fetchWithRetry` オプションへ展開。片方だけ直して他方が抜け道になることを防ぐため定数を共有（PBI 08 の Obsidian 経路も同じ定数を使う）。
- **監査 fingerprint**: `f1be34a51b1912bc2c7cf49b59b7d444a32dc9e864513c886ac96b24c295d195` — verdict を **FIXED（2026-10-19）** へ更新。
- **ADR**: `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` の適用範囲を AI 経路へ拡大し、「他の 16 の fetch サイトは固定ホストで挙動不変」という記述が誤り（OpenAI 互換行の `baseUrlKey` はユーザー設定可能）であることを結果セクションに記録。
- **テスト**: `src/background/ai/providers/__tests__/httpSummaryFlow.test.ts` / `httpTestFlow.test.ts` に redirect 拒否テストを追加（実装前に Red を確認）。`src/utils/__tests__/fetch.test.ts` に「ポリシーが platform fetch まで届く」ことを追加。`NO_REDIRECT_FETCH_POLICY` を 15 ファイルのモックファクトリへ追加（Vitest は undefined な named export で throw するため）。
- **ゲート**: `npm run validate` exit 0。PR #180 の CI（validate / test / build / bench-check / wasm-test / a11y / firefox-storage / gitleaks / usability）すべて pass。
- **レビュー**: PBI 01・08 のコミット列を独立レビューで確認（結果は本ファイルの「コードレビュー完了」に反映）。正確性・セキュリティの欠陥は無し。以下は残存リスク・nit として持ち越す。
  - **BDD の検証は「機構」までで「挙動」は未検証**: 追加テストは mock transport が受け取った `init.redirect === 'error'` を pin する（`httpSummaryFlow.test.ts` / `httpTestFlow.test.ts` / `obsidianClient-secure-fetch.test.ts`）。**30x を実際に流して「2 次リクエストが発行されない」ことを確かめるテストは無い**（plain な fetch mock ではブラウザの abort を再現できないため）。テスト戦略の「統合」項（307 を再現して fetch URL が 1 件だけであること）は**未実装のまま残る**。実測はブラウザ／E2E の owner 観測に委ねる。→ **2026-10-19 に PBI [2026-10-19-04](2026-10-19-04-fix-redirect-real-behavior-e2e.md) で解消**（実サーバ + 実ブラウザの E2E で、転送先へのリクエスト 0 件・Authorization 非到達・`follow` なら到達する対照を実測）。
  - **定数の共有範囲**: `src/background/handlers/systemHandlers.ts:104` は今も `redirect: 'error'` をリテラルで持ち、`NO_REDIRECT_FETCH_POLICY` を共有していない（挙動は正しい）。また定数は全 5 呼び出し元で**先頭**に spread しているため、同じリテラル内で後から `redirect:` を書くと黙って上書きできる。型（`Omit<RequestInit,'redirect'>`）や lint での防御は未導入。
  - **テストが実定数の値を見ていない**: AI 経路のテストは `utils/fetch.js` をモックして `{ redirect: 'error' }` を自前で書いており、`fetch.test.ts` の素通しテストも自前リテラルを渡す。実定数の値を変えた場合に検知できるのは Obsidian 側のテスト（実モジュールを使う）だけ。
  - **gist / tranco 経路は未適用**（同一クラスの残り）: `gistSyncTarget.ts` は `Authorization: token <PAT>` を付けて platform 既定の `follow` のまま。ADR 2026-08-29 の「固定ホストだから挙動不変」という記述を 2026-10-19 に訂正し、PBI 25 と併せて扱う残存リスクとして記録した。

## 関連
- [x] 同じ src/utils/fetch.ts を触るため、実装時は PBI 08（ssrf-guard Obsidian 経路）と競合しないこと（両者とも redirect:'error' 追加で共通化できるため、統合実装も検討）
- pbi/00-INDEX.md