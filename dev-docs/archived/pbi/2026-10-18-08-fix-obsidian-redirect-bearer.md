# PBI: Obsidian vault の read/write 経路に redirect ガードを適用し、Bearer とノート本文の未検証アドレス流出を止める

## ユーザーストーリー

Obsidian vault の運用者として、Obsidian Local REST API への日次ノートの読み書きが、保存した vault origin 以外へ `Authorization: Bearer` とノート本文を送り出さないことを保証してほしい、なぜなら Bearer キーと閲覧履歴を含むノート本文が未検証のアドレスに複製されれば、vault 設定ひとつを掌握した時点で手元の認証情報がそのまま漏れるからだ。

## 優先度

- 順位: 08 / 25
- RICE: 3000（Reach=300 / Impact=1 / Confidence=80% / Effort=0.1）
- 根拠: 監査8位。Obsidian vault の read/write 経路は `_fetchExistingContent` / `_writeContent` とも redirect オプションを指定せず platform デフォルトの follow が効き、pre-hop のゲート（`validateUrl` / `CSPValidator` の保存オリジン完全一致 + loopback ポート固定）だけを通す。保存済み vault origin が 30x を返すと Authorization Bearer とノート本文が検証していないアドレスへ流れる。`FETCH_URL` 経路が持つ `redirect:'error'` と `response.redirected` ガードはこの経路に拡張されていない。影響は「既存の vault operator への直接流出」に追加で「未検証アドレスへの流出」が加わる点で、限界的ながら制御の穴としては明確。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（Obsidian Local REST API がリダイレクトに依存しないことが前提。依存する場合は replacement を owner が判断）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `ssrf-guard:pre-hop-only-gates-redirect-follow-obsidian-put`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（NEEDS-VALIDATION.md 22番）。

claimed root cause: `_fetchExistingContent` と `_writeContent` は redirect オプションも `response.redirected` チェックも持たず `fetchWithTimeout` を呼ぶが、この経路上のゲート（`validateUrl`、`CSPValidator.isUrlAllowed` + `savedObsidianOrigins`）はすべて pre-hop の URL しか評価しない。`FETCH_URL` ハンドラが持つ `redirect:'error'` 方針と `response.redirected` の body ガードは、この経路に拡張されていない。

- [entrypoint] `src/background/obsidianClient.ts:238`（`appendToDailyNote`）— 検証済み設定から daily-note URL を組み立て、既存本文を読む（`:256`）→ 結合した本文を書く（`:264`）。
- [propagation] `src/utils/fetch.ts:128`（`fetchWithTimeout`）— `validateUrl` の pre-hop プロトコルチェック（`:112`）と `CSPValidator.isUrlAllowed` の pre-hop 完全一致（`:128`）、任意の `allowedUrls`（`:140-143`）はすべて初期 URL のみ評価。ホップ毎の再検証は存在しない。
- [sink] `src/background/obsidianClient.ts:306`（`_writeContent`）— vault Bearer ヘッダーとノート本文を伴う PUT。redirect オプションなし。`:275` の GET も同じ姿勢。

既存対照: ADR 2026-08-29（`dev-docs/ADR/2026-08-29-fetch-redirect-policy.md`）は `FETCH_URL` にのみ `redirect:'error'` を適用し、`fetchWithRedirectGuard` を将来の攻撃者影響 URL 規約として出荷済み。本 PBI はその適用範囲を Obsidian 経路へ拡大する。

## BDD受け入れシナリオ

1. **Scenario: 保存済み vault origin が 307 を返すとき**
   - **Given** 設定済み vault origin へ `Authorization: Bearer <key>` 付きで定期記録が送信されている
   - **When** その origin が `307 Temporary Redirect`（`Location: http://127.0.0.1:9222/vault/daily/`）を返す
   - **Then** リダイレクト先への 2 次リクエストが発行されないこと
   - **And** `Authorization` ヘッダーもノート本文もリダイレクト先へ送信されないこと
   - **And** 日次ノート書き込みは失敗として終了し、ノート本文の部分書き込みが残らないこと

2. **Scenario: 正常応答時は従来どおり成功する**
   - **Given** 設定済み vault origin が daily-note に対して `200 OK` を返す
   - **When** 日次ノート追記を実行する
   - **Then** GET（既存本文の読み出し）と PUT（結合本文の書き戻し）が従来どおり成功すること
   - **And** 送出されるリクエストが 2 本（GET と PUT）であること（余分なリクエストが増えないこと）

3. **Scenario: ゲートを通過しないリダイレクト先は拒否される**
   - **Given** リダイレクト先が保存済み vault origin と異なるオリジンである（same-origin リダイレクトを除く）
   - **When** Obsidian の fetch がその 30x を返す
   - **Then** `redirect:'error'` 相当の中止が起き、リダイレクト先が `fetchWithRedirectGuard` によるホップ毎再検証の対象として扱われないこと

4. **Scenario: リダイレクトなしの 404 は従来どおり空文字扱い**
   - **Given** daily-note が未作成で vault origin が `404` を返す
   - **When** 日次ノート追記を実行する
   - **Then** 既存本文を空文字として扱い、新規セクションがそのまま書き込まれること（リダイレクトガード導入で 404 扱いが壊れない）

5. **Scenario: 接続テスト経路も同じ方針を共有する**
   - **Given** 接続テスト（`testConnection` / `_fetchConnectionResponse`）が vault Bearer ヘッダー付きで GET する
   - **When** その origin が 30x を返す
   - **Then** 同じ redirect 方針が適用され、リダイレクトへの 2 次リクエストが発生しないこと

## 受け入れ基準

- [x] `_fetchExistingContent` の fetch が `redirect:'error'` を明示し、platform デフォルトの `follow` に依存しないこと
- [x] `_writeContent` の fetch が `redirect:'error'` を明示し、platform デフォルトの `follow` に依存しないこと
- [x] `_fetchConnectionResponse`（接続テスト経路）も同じ redirect 方針を共有すること。共有しない判断をする場合は理由をコードコメントに残すこと
- [x] FETCH_URL 経路と同様に `response.redirected` が true の場合、多層防御として body を採用しないこと（読み取り経路・書き込み経路の両方）
- [x] リダイレクトで中止された場合に、既存の failure taxonomy（`failureTaxonomy.ts`）の kind を持つエラーが送出され、ユーザ向け文言が status 数値を漏らさないこと
- [x] `appendToDailyNote` の mutex 解放が、リダイレクト abort・タイムアウト・部分失敗のいずれでも保証されること（例外経路でロックが残らない）
- [x] 既存テスト（`src/background/__tests__/obsidianClient*.test.ts`、`src/utils/__tests__/fetch*.test.ts`）が全て緑で、リダイレクトと無関係な挙動の非互換がないこと
- [x] ADR 2026-08-29 の適用範囲に Obsidian vault 経路が追記され、`redirect:'error'` を共通 seam に切り出した場合は ADR 本文と決定理由が更新されていること

## テスト戦略

- 単体: mock chrome + `global.fetch` stub で 307 + `Location` を返し、2 次リクエストが発生しないこと・`Authorization` ヘッダーとノート本文が送信されないこと・GET と PUT の両方で同じことを検証する。`response.redirected` が true のレスポンスを強制的に注入し、body が採用されないことを別途 pin する。`redirect:'error'` の指定自体は fetch stub が受け取った init オブジェクトを検査して直接 assert する（実ブラウザの挙動に依存しない）。
- 統合: `obsidianClient` の daily note 経路（`appendToDailyNote`）を、200 応答・404 応答・307 応答の 3 ケースで通しで実行する。308/302 も `REDIRECT_STATUS_CODES` と整合する形でケース分けする。接続テスト経路（`testConnection`）の 307 も 1 ケース追加する。`vi.useFakeTimers()` の既定オプションは使わない（AGENTS.md の待機方針）。
- E2E: owner 観測（制御された redirecting vault）。隔離テストプロファイルに 30x を返す vault エンドポイントを立て、実ブラウザ上で Bearer ヘッダーの持ち越しを実測する。E2E に実時間の sleep は入れず、リダイレクトサーバの readiness を上限つきポーリングで待つ。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 現状 |
|---|---|---|
| `src/background/obsidianClient.ts` | 275 | `_fetchExistingContent` — `fetchWithTimeout(url, { method:'GET', headers })`。redirect オプションなし |
| `src/background/obsidianClient.ts` | 306 | `_writeContent` — `fetchWithTimeout(url, { method:'PUT', headers, body })`。redirect オプションなし |
| `src/background/obsidianClient.ts` | 356 | `_fetchConnectionResponse` — 接続テスト GET。redirect オプションなし（同一ファイル内の第 3 サイト） |
| `src/utils/fetch.ts` | 155 | `fetch(url, { ...fetchOptions, signal })`。呼び出し側オプションの spread で redirect デフォルトは指定されない |
| `src/utils/fetch.ts` | 201 | `fetchWithRedirectGuard` — `redirect:'manual'` + ホップ毎 `validateUrlForFilterImport`（最大 5 ホップ）。攻撃者影響 URL 向け |
| `src/background/handlers/systemHandlers.ts` | 104 | `FETCH_URL` の `redirect:'error'` 設定 |
| `src/background/handlers/systemHandlers.ts` | 110 | `response.redirected` の body ガード |
| `src/utils/cspValidator.ts` | 186-200 | `savedObsidianOrigins` — pre-hop かつ文字列完全一致。不正な保存設定は空集合を寄与（ゲートを広げない） |

### 最小変更の選択肢

1. **Obsidian の fetch オプションに `redirect:'error'` を付ける（FETCH_URL 経路と同じ形）** — 推奨。3 箇所の呼び出しに 1 行ずつ `redirect:'error'` を追加するだけ。ADR 2026-08-29 の決定を再利用でき、ブロッカー 3（Obsidian Local REST API がリダイレクトに依存しない）が成立するなら最も安価で正しい修正になる。
2. **攻撃者が影響しうる URL 向けの共通ガード `fetchWithRedirectGuard` を本経路にも適用する** — 本経路の URL はユーザー設定済みの vault origin であり攻撃者が影響するものではないため、`validateUrlForFilterImport`（private IP ガード）を構成する要素が過度に厳しい。ただし「vault origin の設定を攻撃者が書き換えられる」 tying を将来想定する場合はこの方が安全。採用する場合は hop 数の扱い（GET は可、PUT は body 再送の可否）を明示すること。

**推奨: 選択肢 1 を実装し、選択肢 2 は代替として記録のみ。** ただし本 PBI では両者を排他とはせず、実装時に owner がブロッカー 3 の答え次第で判断する。

### ファイル競合回避（PBI 01 との together 実装）

本 PBI と PBI 01（AI fetch の `redirect:'error'` 化）は **`src/utils/fetch.ts` を共有する**。`redirect:'error'` を共通 seam（例: `FetchOptions` の専用フラグ、または明示的な `DEFAULT_REDIRECT_POLICY` 定数）へ切り出せば、両者を一度の編集で入れられる。

- together 実装時の推奨 hunk 分割: fetch.ts の seam 追加を先に、本 PBI の呼び出し側変更を後に置く。
- together 実装時の検証: `npx vitest run src/utils/__tests__/fetch.test.ts src/background/__tests__/obsidianClient.test.ts --repeats=20 --retries=0`。
- together 実装時の記録: ADR 2026-08-29 の適用範囲に「Obsidian vault read/write」と「AI provider fetch」の両方を追記。

### ブロッカー（着手前に潰すべき owner 確認）

1. **ブラウザが跨オリジン redirect で Authorization を運送するか** — Chromium/Edge/Firefox で、拡張 service worker の fetch が跨オリジン 30x を追った場合、`Authorization` ヘッダーがリダイレクト先へ運送されるか。これが未観測の事実であり needs_validation の留保理由そのもの。確認結果次第で本 PBI の影響評価は「資格情報とノート本文の流出」から「リクエスト行だけが渡る場合」に狭まる。
2. **リダイレクト後応答が CORS 読み取り可能か** — 2 次応答の body が拡張から読めるか。読めなければ影響は送信側に閉じる。
3. **Obsidian Local REST API が redirect に依存しないか** — 依存する場合、`redirect:'error'` ではなく replacement（hop 毎再検証）を owner が判断する。

いずれも owner 確認として PBI の冒頭に置き、実装着手の前に対応する（source-only 実行境界のもと未確認のまま「直した」としない）。

### ロールバック手順

1. 変更は `src/background/obsidianClient.ts` の 3 箇所の fetch オプションと、together 実装した場合は `src/utils/fetch.ts` の seam 追加に限定する。
2. ロールバックは上記 hunk を戻すだけで足りる（設定・ストレージ・manifest の変更を含まないためデータ移行は不要）。
3. リダイレクト方針の実装が「vault 接続できなくなった」という報告を受けた場合、まず ADR 2026-08-29 の判断根拠（供給元は固定 HTTPS ホスト）を再確認し、必要なら選択肢 2（hop 毎再検証）へ置換する。置換も上記 hunk 内の変更に閉じる。
4. 回帰が疑われる場合は新規統合テストの 3 ケース（200 / 404 / 307）を単発実行し、303/302/308 を追加して境界を確認する。

## 見積もり

0.1 SP（人週 0.5 日）。ブロッカー 3 の owner 確認（0.5 時間）→ 実装 3 hunk（1-2 時間）→ BDD シナリオの自動テスト（2-3 時間）→ `npm run validate` とレビュー（1-2 時間）。together 実装する場合の追加はゼロ（seam 化を含む）。

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス
- [x] `npm run validate` が緑
- [x] 監査 fingerprint を完了記録に残す（`ssrf-guard:pre-hop-only-gates-redirect-follow-obsidian-put`）
- [x] コードレビュー完了（独立レビュー。正確性・セキュリティの指摘なし。残った指摘は完了記録の残存リスクへ記録）
- [x] ドキュメント更新済み（ADR 2026-08-29 の適用範囲を本経路にも拡大）

## 調査結果（2026-10-18）

- 判定: 構造確定（`redirect` オプション未適用・3 サイトとも）／仕様確定
- 決め手: `_fetchExistingContent` / `_writeContent` / `_fetchConnectionResponse` が `redirect` なしで fetch することを呼び出し引数で pin。Authorization はクロスオリジンリダイレクトで剥がれるため **Bearer キー値の流出は起きにくい**が、307/308 で**ノート本文が保持・転送**され、リクエスト自体は loopback に届く
- 影響: 重大度は「Bearer 流出」から「本文・リクエストの転送」に寄る。**Impact 1→0.5、Confidence 80→100（RICE 3000→1500）**。E2E 観測は本文転送の実測に差し替える

## 完了記録（2026-10-19）

- **判定**: 修正完了（PBI 01 と together 実装）。Obsidian の read / write / 接続テストの 3 経路が `redirect:'error'` を明示し、platform 既定の `follow` に依存しない。
- **実装**: `src/background/obsidianClient.ts` の `_fetchExistingContent`（GET）/ `_writeContent`（PUT）/ `_fetchConnectionResponse`（接続テスト）が共通 seam `NO_REDIRECT_FETCH_POLICY`（`src/utils/fetch.ts`）を展開。read / write には多層防御として `if (response.redirected) throw tagFailure(..., FailureKind.NETWORK)` を追加（`redirect:'error'` が効かない実装差の保険）。
- **監査 fingerprint**: `ssrf-guard:pre-hop-only-gates-redirect-follow-obsidian-put` — verdict を **FIXED（2026-10-19）** へ更新。
- **ADR**: `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` の適用範囲に Obsidian vault 経路を追記（AI 経路と同時）。
- **テスト**: `src/background/__tests__/obsidianClient-secure-fetch.test.ts` に `describe('redirect policy')` を新設（5 テスト、実装前に Red を確認）。GET / PUT / 接続テストの 3 経路で fetch 引数を pin し、`response.redirected` の body 拒否も pin。
- **ゲート**: `npm run validate` exit 0。PR #180 の CI すべて pass。`obsidianClient*.test.ts` の既存テストは非互換なし。
- **レビュー**: PBI 01・08 のコミット列を独立レビューで確認（結果は本ファイルの「コードレビュー完了」に反映）。正確性・セキュリティの欠陥は無し。残存:
  - **`response.redirected` の多層防御は実リダイレクトでは未検証**: `redirect:'error'` が有効な限り platform は Response を返す前に拒否するため、このガードは到達しない（テストは mock で `redirected:true` を注入して pin している）。実挙動の確認はブラウザ／E2E のみ可能。
  - **接続テスト経路（`_fetchConnectionResponse`）には `redirected` ガードを置いていない**（read/write のみ）。`redirect:'error'` が主防御であり、接続テストは本文を採用しないため実害は無いが、対称性としては残る。
  - PBI 01 の完了記録にある残存リスク（30x 実測の不在、定数の共有範囲、テストが実定数を見ない点、gist / tranco 未適用）は本 PBI にも同様に当てはまる。

## 関連

- `pbi/00-INDEX.md`
- PBI 01（同じ fetch.ts の別箇所）— 実装時に together 行うと効率的
- `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` — 本 PBI が拡大する適用範囲の原本
- `dev-docs/SECURITY_REVIEW_GUIDE.md` — SSRF / CWE-918 の脅威モデル
- `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（findings.json / NEEDS-VALIDATION.md 22番）