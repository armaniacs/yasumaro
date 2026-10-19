# ADR: FETCH_URL Redirect Policy — redirect: 'error'

## ステータス
採用（2026-10-18: 適用範囲を AI 経路と Obsidian 経路へ拡大）

## 日付
2026-08-29

## コンテキスト
`FETCH_URL` メッセージハンドラ (`src/background/handlers/systemHandlers.ts`) は
uBlock フィルタリストの import 用に任意 URL を fetch する。URL は
`validateUrlForFilterImport` (protocol + private IP + localhost ガード) で検証
されるが、検証されるのは初期 URL のみである。

`fetch` はブラウザ既定の `redirect: 'follow'` でリダイレクトを黙って追跡する
ため、許可された URL が 30x で `http://127.0.0.1:9222` 等の内部アドレスへ
リダイレクトすると、Service Worker がその内部応答を取得して呼び出し元へ返す
(SSRF / CWE-918, VULN-016)。拡張ページから直接到達できない private IP への
SW 仲介アクセスという新たな capability になる。

対策の選択肢:
1. `redirect: 'error'` — リダイレクトが起きた時点で fetch を失敗させる。1 行。
2. `redirect: 'manual'` + ホップ毎に `validateUrlForFilterImport` で再検証。

## 決定
`FETCH_URL` の fetch には **`redirect: 'error'`** を設定する。

既定・カスタムを含む既知のフィルタリスト供給元
(`raw.githubusercontent.com` / `gitlab.com` / `easylist.to` / `pgl.yoyo.org` /
`nsfw.oisd.nl` 等) はいずれも固定 HTTPS ホストで、http→https 昇格やミラー
リダイレクトに依存していない。したがって最も厳格な `redirect: 'error'` を
選んでも正当なユースケースを損なわない。

多層防御として、ハンドラは `response.redirected` も確認し、true の場合は
body を返さない。

将来、リダイレクトを正当に必要とする攻撃者影響 URL の fetch が現れた場合の
規約として、`src/utils/fetch.ts` に `fetchWithRedirectGuard(url, options)` を
新設する。これは `redirect: 'manual'` でリダイレクトを自前追跡し、各ホップの
`Location` に `validateUrlForFilterImport` を再適用する (最大 5 ホップ、
相対 Location は現在のホップ URL に対して解決、Location 欠落・ループは reject)。
`FETCH_URL` は現状これを使わないが、契約として出荷する。

### 追記 (2026-10-18): AI 経路への適用範囲拡大

`FETCH_URL` だけを塞いでも穴は残っていた。AI 要約と接続テストの 2 経路
(`src/background/ai/providers/HttpProviderStrategy.ts`) は同じ
`fetchWithTimeout` を使いながら `redirect` を指定しておらず、既定の
`'follow'` のままだった。許可済みプロバイダが 30x を返すと、`Location` が
指す未検証アドレス (loopback を含む) へ資格情報ヘッダーとプロンプト本文が
再送される。

本 ADR は当初「AI プロバイダは固定ホスト」と整理していたが、これは誤りで
ある。OpenAI 互換の `baseUrl` はユーザーが設定でき
(`src/utils/storage/providerAllowlist.ts`)、Obsidian の vault URL も
ユーザー設定である。よって AI 経路にも `redirect: 'error'` を適用する
(`NO_REDIRECT_FETCH_POLICY`)。要約と接続テストの両フローが同じ 1 つの宣言を
読み、片方だけに適用すると同じ資格情報を持つもう一方が抜け道として残る。

帰結: 許可済みの宛先が 30x を返した場合、AI の要約・接続テストと Obsidian の
日次ノート read/write・接続テストは失敗する。主要エンドポイント
(Gemini / OpenAI 互換) と Obsidian Local REST API はいずれも固定 origin で
リダイレクトに依存しないため、正当な利用は損なわれない。30x の拒否は
transport failure として届くため共有リトライ方針で再送されうるが、再送しても
転送先へのリクエストは発行されない (安全側)。

Obsidian 経路 (`src/background/obsidianClient.ts`) の read/write には、
`redirect: 'error'` に加えて `response.redirected` を検査する多層防御を置いた。
将来この方針を緩めた場合でも、platform が redirected を立てた応答の本文を
ノートとして採用しない。両経路とも `src/utils/fetch.ts` の
`NO_REDIRECT_FETCH_POLICY` を共有し、片方だけが抜け道にならないようにしている。

## 結果
- VULN-016 の実証済み攻撃経路 (許可 URL → 30x → private IP body 返却) が塞がれる。
- `FETCH_URL` 以外の fetch サイトは当初「固定ホスト」として挙動不変と整理して
  いたが、**この整理は誤りだった**。AI プロバイダの OpenAI 互換 `baseUrl` と
  Obsidian の vault URL はユーザーが設定できる。2026-10-18 に AI 経路
  (要約・接続テスト) と Obsidian 経路 (日次ノートの read/write と接続テスト) へ
  同じ `redirect: 'error'` を適用した。
- **残る fetch サイトと残存リスク（2026-10-19 追記）**: tranco と gist は初期 URL が
  固定ホストだが、**「ホストが固定だから挙動不変」は言えない**。`gistSyncTarget.ts`
  の 3 サイトは `Authorization: token <PAT>` を付けて platform 既定の
  `redirect: 'follow'` のまま fetch するため、`api.github.com` が 30x を返すと PAT が
  `Location` のホストへ再送される（tranco は資格情報を持たないが、やはり 30x を
  追従する）。`api.github.com` は HSTS 付きの固定ホストで、GitHub 側か TLS が
  破られない限り到達しないため**優先度は低い**が、この経路にも
  `NO_REDIRECT_FETCH_POLICY` を適用するのが本 ADR の趣旨に沿う。2026-10-19 に
  PBI を起票した: `pbi/2026-10-19-06-fix-gist-tranco-redirect-policy.md`
  (適用したら本節を「適用済み」へ更新すること)。実挙動の検証は
  `dev-docs/archived/pbi/2026-10-19-04-fix-redirect-real-behavior-e2e.md`（2026-10-19 完了）、宣言の一本化は
  `pbi/2026-10-19-05-fix-redirect-single-declaration.md` で扱う。
- **実挙動の実測（2026-10-19 追記）**: それまでのテストは `init.redirect === 'error'`
  という**オプションの存在**を pin するだけで、30x が実際に来たときにブラウザが何を
  するかは測っていなかった。実サーバ（307 + リクエスト記録）と実ブラウザを使う E2E
  `testDir/e2e/redirect-policy-real-behavior.spec.ts` を追加し、次を実測で固定した:
  (1) `redirect:'error'` では `Location` 先へ**2 次リクエストが 0 件**、
  (2) 拒否は `TypeError: Failed to fetch` として届き `LEGACY_TRANSPORT_MARKERS_FULL`
  経由で transport failure と判定される（再送は当初 URL のみ）、
  (3) 307 で `Authorization` ヘッダーが転送先へ**届かない**。
  対照として `redirect:'follow'` なら到達することも同じ spec で固定している（これが
  無いとフィクスチャが壊れていても green になる）。同時に、Obsidian 接続テストに
  read / write と対称な `response.redirected` ガードを追加した（それまで接続テストだけ
  抜けていた）。詳細は `dev-docs/archived/pbi/2026-10-19-04-fix-redirect-real-behavior-e2e.md`。
- `src/background/handlers/systemHandlers.ts` は今も `redirect: 'error'` を
  リテラルで書いており、上記の `NO_REDIRECT_FETCH_POLICY` を共有していない。
  FETCH_URL 経路の挙動は正しいが、「宣言は 1 箇所」という整理は厳密には
  まだ成り立っていない。
- ホップ毎再検証ヘルパーが将来の fetch 追加のための規約として存在する。

## 参照
- `src/background/handlers/systemHandlers.ts` — `createFetchUrlHandler`
- `src/utils/fetch.ts` — `fetchWithRedirectGuard`
- `src/utils/ssrfGuard.ts` — `validateUrlForFilterImport` / `isPrivateIpAddress`
- PBI: `pbi/2026-08-29-09-fix-fetch-redirect-ssrf.md`
- PBI: `dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md` (AI 経路への適用)
- PBI: `dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md` (Obsidian 経路)
