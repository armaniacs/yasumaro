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
  同じ `redirect: 'error'` を適用した。tranco / gist は固定ホストのままで
  挙動不変。
- ホップ毎再検証ヘルパーが将来の fetch 追加のための規約として存在する。

## 参照
- `src/background/handlers/systemHandlers.ts` — `createFetchUrlHandler`
- `src/utils/fetch.ts` — `fetchWithRedirectGuard`
- `src/utils/ssrfGuard.ts` — `validateUrlForFilterImport` / `isPrivateIpAddress`
- PBI: `pbi/2026-08-29-09-fix-fetch-redirect-ssrf.md`
- PBI: `pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md` (AI 経路への適用)
- PBI: `pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md` (Obsidian 経路)
