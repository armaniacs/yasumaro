# PBI: プロバイダ baseUrl 認可の強化

## ユーザーストーリー
AI プロバイダを設定する利用者として、プロバイダ API キーとページ内容が設定したプロバイダ以外の origin へ送信されないようにしたい、なぜなら細工された設定や設定同期でキーが攻撃者 origin へ流れることが監査で実証されたから。

## 優先度
- 順位: 2 / 6
- RICEスコア: 24（Reach=8 / Impact=3 / Confidence=1.0 / Effort=1）
- 根拠: 実証済みの認証情報外流（High）。VULN-003 は VULN-002 の enabler で同一ファイル群のため統合。

## 背景（2026-09-22 時点の現状）
- VULN-002（CWE-522/668、High、テスト PASS）: `src/background/ai/providers/OpenAIProvider.ts:88-99` の `isAllowedProviderBaseUrl` は deny-only の SSRF ガードで host 許可リストがないため任意の公開ホストが通る。`src/utils/cspValidator.ts:133-153` の `addBaseUrlDomain` がその毒された host を毎 fetch（`src/utils/fetch.ts:113`）で CSP `allowedDomains` に自己認可する。`GeminiProvider`（`:185-195` 付近）と `BuiltInAiProvider`（`:28` 付近）にはゲート自体がない（grep 検証済み）。
- VULN-003（CWE-1188/636、Medium、テスト PASS）: `src/utils/storage/urlWhitelist.ts:125-129` の `getAllowedUrls` は `ALLOWED_URLS` ストアキーを読むが本番の writer がゼロ（`buildAllowedUrls` は FETCH_URL ハンドラにしか供給していない）。`src/utils/fetch.ts:237-241` の `isUrlAllowed` は空集合で fail-open（全部許可）。
- 監査エビデンス: `obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/README.md` の VULN-002 と VULN-003（PoC と exploit_tests は同ディレクトリ）。

## 修正戦略
1. `providerAllowlist.ts`（`:213+` 付近）: プロバイダ種別ごとの固定 origin 拘束。固定プロバイダは pin した origin、ユーザー設定の `openai-compatible` は「ユーザーが明示確認した origin のみ」ポリシー（保存時にダイアログで対象 origin を見せる / 変更時に再確認）。ローカル loopback origin（LM Studio / Ollama 等、`ssrfGuard.ts:207` の `ALLOWED_LOCALHOST_PORTS` と整合）は例外的に許可。
2. `GeminiProvider.ts` と `BuiltInAiProvider.ts` に OpenAIProvider と同型のコンストラクタゲートを追加。
3. `cspValidator.ts:133-153`: `addBaseUrlDomain` が設定由来の host を自己認可しない（認可は許可リスト側で行う）。
4. VULN-003: `urlWhitelist.ts:79-118` の `buildAllowedUrls` 出力を設定書き込みのたびに `ALLOWED_URLS` キーへ永続化、`fetch.ts:237-241` は空 / null 集合で `false` を返す（fail-closed）。

## 設計上の制約
- 移行パス: 既存ユーザーはストアが空のため、fail-closed 化の前に初回起動 / 設定書き込みで `buildAllowedUrls` をシードする。シード前に fail-closed にすると FETCH_URL が全拒否になる。
- ユーザー設定プロバイダの baseUrl 自由度は残す（LM Studio 等の正規利用）。拘束対象は「確認なしで権利証が変わること」であり、明示確認付きなら任意 origin を許可してよい。PBI ではポリシーレベルに留め、UI 詳細は実装段階で決める。
- 関連（依存はしない）: `pbi/2026-09-22-03-backlog-local-provider-origin-rule.md` は CORS Origin-strip の一般化で、本 PBI とは別件。

## BDDシナリオ
Scenario: pin された固定プロバイダの既定 URL でのリクエストは従来どおり成功する
  Given 固定プロバイダの既定 baseUrl を設定する
  When  通常のリクエストを送る
  Then  キー付き fetch がその origin に到達し成功する

Scenario: ユーザー確認なしで provider_base_url を attacker.example に変えても、キー付き fetch がその origin に飛ばない（エクスプロイト回帰）
  Given `provider_base_url` を `attacker.example` に書き換える
  When  確認なしでキー付き fetch を試みる
  Then  その origin への送信が拒否される

Scenario: ALLOWED_URLS が空の状態で FETCH_URL は拒否され（fail-closed）、シード後は正当な URL が通る（境界）
  Given `ALLOWED_URLS` が空である
  When  FETCH_URL を送る
  Then  拒否される。`buildAllowedUrls` のシード後は正当な URL が通る

## 受け入れ基準
- [x] 3 プロバイダすべてに同一水準の baseUrl ゲートがある
- [x] `addBaseUrlDomain` が設定由来 host を自動で allowedDomains に入れない
- [x] ALLOWED_URLS の writer が実在し、fail-closed に変わった
- [x] ユーザー確認フロー（ポリシー）がテストで pin されている
- [x] 既存の Ollama / LM Studio 正規利用の回帰テストが緑

## テスト戦略
- 単体: providerAllowlist のポリシー表、cspValidator の非自己認可、isUrlAllowed の空集合挙動
- 統合: `npm run validate`

## 見積もり
5 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] type-check / lint / test / build が通る
- [x] ドキュメント更新済み（プロバイダ設定の説明）

## 実装記録（2026-09-23）
- コミット 8584718a。providerAllowlist に origin 認可ポリシー（pinned row domain / 既知プロバイダドメイン / ユーザー確認済み origin / loopback 例外）を新設し、Gemini・Built-in AI に同型ゲートを追加。cspValidator の addBaseUrlDomain を非自己認可化。ALLOWED_URLS は allowedUrlsSync（SW 起動シード + 設定変更再同期）で常時最新化し、isUrlAllowed を空集合 fail-closed に変更。確認済み origin は `confirmed_provider_origins`（デバイスローカル・export/import 除外）に記録し、settingsPipeline と models-dev-dialog の保存経路で確認ダイアログ（showConfirmDialog seam）を出す。
- 設計裁定: プロバイダ fetch はストレージキー読み取りから構築時 settings 由来の毎回新鮮な buildAllowedUrls に変更（シード競合の排除）。pinned required-tier ドメインは許可集合に常に含む（catalog 既定 URL の取りこぼし防止）。
- なぜなぜ分析: /tmp/whywhy/vuln-002-003-provider-baseurl-authorization.md
- 検証: type-check / lint 0 errors / test 13,358 green / build green。残: GitHub PR レビュー
