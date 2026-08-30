# ADR: FETCH_URL Redirect Policy — redirect: 'error'

## ステータス
採用

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

## 結果
- VULN-016 の実証済み攻撃経路 (許可 URL → 30x → private IP body 返却) が塞がれる。
- 他 16 の fetch サイト (tranco / gist / obsidian / AI プロバイダ — 固定ホスト)
  は挙動不変。リダイレクト方針の変更は `FETCH_URL` 系のみ。
- ホップ毎再検証ヘルパーが将来の fetch 追加のための規約として存在する。

## 参照
- `src/background/handlers/systemHandlers.ts` — `createFetchUrlHandler`
- `src/utils/fetch.ts` — `fetchWithRedirectGuard`
- `src/utils/ssrfGuard.ts` — `validateUrlForFilterImport` / `isPrivateIpAddress`
- PBI: `pbi/2026-08-29-09-fix-fetch-redirect-ssrf.md`
