# PBI: Obsidian ホスト検証器の parser-differential を塞ぎ、エンコード済み IPv4 ラベルの Bearer 流出を止める

## ユーザーストーリー

Obsidian vault の運用者として、`0x7f000001` や `0x7f.0.0.1` のような「DNS 名として正しければ受け入れる」ホスト値を保存しただけで、`Authorization: Bearer` と閲覧履歴入りノート本文がバリデータが意図しなかったアドレスへ送られないことを保証してほしい、なぜなら検証器（validateObsidianHost）が「この文字列は通常のホスト名だ」と判定したものと、ブラウザの URL パーサが「これは 127.0.0.1 だ」と解決するものが食い違っており、その差分が資格情報の持ち出し口になるからだ。

## 優先度

- 順位: 14 / 25
- RICE: 1000（Reach=200 / Impact=0.5 / Confidence=100% / Effort=0.1）
- 根拠: 監査14位。`validateObsidianHost` は hex 表記の IPv4 相当ラベル（`0x7f000001`、`0x7f.0.0.1`）を正当な RFC-1123 ホスト名として通し、`buildFromSettings` がそれを `baseUrl` に組み立てて Bearer を付ける。URL パーサが同ラベルを IPv4 リテラルに再解釈すれば、validator が承認しなかったアドレスに資格情報とノート本文が届く。**10進単独形（`2130706433`）は digit-dot ガードが既に拒否するため、hex 含有形だけが survivors**（監査側が明示的に訂正した点。実装者はこの訂正を引き継ぐこと。hunter の主張どおりに10進形も対象と書かない）。既存の fetch 系には `BLOCKED_PATTERNS` / `decodeNumericIPv4` という同種の拒否族が存在するが、Obsidian 検証器には等価物がない（Obsidian 経路は `blockLocalhost:false` で走るので `BLOCKED_PATTERNS` は発動しない）。この低深刻度の cross-principal チェーンには settings 汚染（dashboard XSS の既知限界）が必要条件。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（正当なリモート https ホストと loopback 名は従来どおり通る。`0x` を含む正当 DNS 名を巻き込み得るため誤拒否の向きは要確認）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `0ee29ec604d1788f7f73156689eeddf065be733a861cd5924f7c776636f8d19c`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（NEEDS-VALIDATION.md 1番 / findings.json `$[1]`）。

claimed root cause: `validateObsidianHost` の digit-or-dot ガードは「数字とドットだけ」の形しかカバーせず、RFC-1123 ラベル検査には「IPv4 を表現しうるエンコード付きラベル」を拒否する規則がないため、validator のアドレス認識と URL パーサの解決結果が食い違う。

### Trace（監査記録）

- [entrypoint] `src/utils/obsidianValidator` 相当 — `validateObsidianHost`（実ファイル `src/utils/obsidianConfigValidator.ts:84`）。空白・`/`・`\`・`@`・`%` と純粋に不正な IPv4 を拒否した後、RFC-1123 ラベルを受理する。`0x7f000001` / `0x7f.0.0.1` は通常のホスト名として通る。
- [propagation] `buildFromSettings`（`src/utils/obsidianConfigBuilder.ts:66`）。検証済み host を `baseUrl`（`:91`）に組み立て、`Authorization` Bearer（`:94`）を付ける。CSP の `savedObsidianOrigins` 導出（`src/utils/cspValidator.ts:186-200`）も同じ validator を通る。
- [sink] `_writeContent`（`src/background/obsidianClient.ts:305-306`）— vault Bearer とノート本文を伴う PUT。GET は `:274-275`。URL パーサが解決したアドレスへ送られる。

### Evidence（監査記録）

- `src/utils/obsidianConfigValidator.ts:124` — `isValidDnsHostname` は英数字＋ハイフンのラベルを受理する。digit-or-digit ガードは `:117-122` にあり「数字とドットのみ」の形しか覆わない。
- `src/utils/ssrfGuard.ts:12` — fetch 経路向けの拒否族（`BLOCKED_PATTERNS`、`providerAllowlist` の `decodeNumericIPv4`）は存在するが `obsidianConfigValidator` に等価物がない。かつ Obsidian 経路の `fetchWithTimeout` は `blockLocalhost:false` で `validateUrl` を呼ぶため `BLOCKED_PATTERNS` は発動しない。
- `src/utils/cspValidator.ts:186` — `savedObsidianOrigins` は同じ validator 経由で導出され、`isUrlAllowed`（`:259`）の `savedObsidianOrigins.has(parsed.origin)`（`:288`）も両辺とも `new URL` を通すので、fetch ゲートはパーサ解決側を「許可」する側に回る。

### 本checkout での実測（source-only / オフライン）

実装着手前に、ローカルの vitest で現行挙動を実測した（使い捨てプローブ、実行後に削除済み）。監査の訂正が正しいことを確認している。

| 入力 | 現行 `validateObsidianHost` | `new URL('https://<host>:27124').hostname`（Node WHATWG） |
|---|---|---|
| `0x7f000001` | **受理**（そのまま返す） | `127.0.0.1` |
| `0x7f.0.0.1` | **受理** | `127.0.0.1` |
| `0X7F.0.0.1` | **受理**（大文字 X も生き残る） | `127.0.0.1` |
| `2130706433` | 拒否（`invalid characters`） | `127.0.0.1` |
| `0177.0.0.1`（8進） | 拒否（digit-dot ガード） | `127.0.0.1` |
| `127.0.0.1` / `localhost` | 受理 | そのまま |
| `0x7f000001.nip.io` | 受理 | `0x7f000001.nip.io`（**再解釈されない**） |

最後の行は誤拒否ガードの根拠として重要である。**「ラベルに `0x` が含まれる」 ではなく「ホスト全体が IPv4 に解決しうる形」で判定しないと、正当な DNS 名（nip.io 等のワイルドカード）を巻き込む。**

## BDD受け入れシナリオ

1. **Scenario: hex 単体形の IPv4 相当ラベルは保存できない**
   - **Given** Obsidian 接続設定でホストに `0x7f000001` を入力した
   - **When** 設定を保存する（`validateObsidianHost` を通る）
   - **Then** 検証が例外を投げ、ホストが保存されないこと
   - **And** ユーザ向けには既存と同じ invalid characters 系のエラーが返ること（新しい文言を足さない）

2. **Scenario: hex 含有のドット区切り形も保存できない**
   - **Given** Obsidian 接続設定でホストに `0x7f.0.0.1`（および大文字変種 `0X7F.0.0.1`）を入力した
   - **When** 設定を保存する
   - **Then** 検証が例外を投げ、ホストが保存されないこと
   - **And** 接続テスト（override 経路）も同じ判定で拒否されること

3. **Scenario: Bearer を付ける前に URL パーサの解決結果と一致することを要求する**
   - **Given** 検証を通過したホスト（validator が受理した文字列）
   - **When** `buildFromSettings` が `baseUrl` を組み立てる
   - **Then** 組み立てられた `baseUrl` を `new URL()` で再解釈し、解決された hostname が検証器の判定と一致することを確かめること
   - **And** 不一致なら `Authorization: Bearer` を組み立てる前に拒否され、`fetch` が 1 本も発行されないこと

4. **Scenario: 回帰ガード — 正規ホストは従来どおり通る**
   - **Given** ホストに `127.0.0.1` / `localhost` / `::1` / `192.168.1.10` / `example.com` / `vault.example.com` を設定した
   - **When** 設定を保存して日次ノート追記を実行する
   - **Then** 従来どおり検証を通過し、`https://<host>:27124` の baseUrl で GET と PUT が送られること
   - **And** リモート https ワークスペース（`vault.example.com`）が引き続き設定可能であること

5. **Scenario: 誤拒否ガード — `0x` を含む正当な DNS 名を巻き込まない**
   - **Given** ホストに `0x7f000001.nip.io` のような、`0x` を含むが IPv4 には解決しない正当な DNS 名を設定した
   - **When** 設定を保存する
   - **Then** 検証を通過し、従来どおり保存されること（ラベル単位の `0x` 検査で弾かない）

6. **Scenario: CSP の保存オリジンゲートが確実に閉じる**
   - **Given** 保存済み Obsidian ホストがエンコード付き IPv4 形である
   - **When** `CSPValidator.initializeFromSettings` が `savedObsidianOrigins` を導出する
   - **Then** 導出が例外になり、`savedObsidianOrigins` が空集合のままになること（現在 similarly、ゲートはパーサ解決側の origin を許可してしまう）

## 受け入れ基準

- [ ] `validateObsidianHost` が、IPv4 を表現しうるエンコード付きホスト（`0x` 整数形、`0x` 含有ドット区切り形、`0X` 大文字変種を含む）を拒否すること。判定は「ホスト全体が 4 オクテットの IPv4 に解決しうる形」で行い、ラベル単位の `0x` 検査ではないこと（`0x7f000001.nip.io` を通すこと）
- [ ] 監査の訂正が実装に引き継がれていること（10進単独形 `2130706433` と 8進形 `0177.0.0.1` は**すでに** digit-dot ガード `:117-122` で拒否済みであり、本 PBI で新たに追加する必要がないこと。この事実をテストとして pin し、誤って「今回追加した」と記録しないこと）
- [ ] `buildFromSettings`（`src/utils/obsidianConfigBuilder.ts:91`）が、Bearer ヘッダーを組み立てる**前に**組み立て済み `baseUrl` を `new URL()` で再解釈し、解決 hostname と検証器の判定が一致することを必須にすること。不一致時は fetch 発行前に失敗し、既存の `failureTaxonomy` kind を持つエラーになること
- [ ] `buildFromOverride`（接続テスト経路、`:130` / `:133`）も同じ再解釈チェックを共有すること（override だけ緩まない経路を作らない）
- [ ] 拒否・不一致時のユーザ向け文言が既存の CONFIGURATION エラー体系に載り、`status` や内部 URL などの情報を漏らさないこと。`validateObsidianHost` の既存メッセージ（`invalid characters`）は維持すること
- [ ] `cspValidator.ts:186-200` の `savedObsidianOrigins` 導出が、検証器の強化により不正保存設定に対して空集合を寄与し続けること（`savedObsidianOrigins` が parser 解決 origin を許可しないこと）
- [ ] 既存テスト（`src/utils/__tests__/obsidianHostCredentialPairing.test.ts:94-122`、`:124-155`、`src/utils/__tests__/obsidianProtocolLoopback.test.ts:29-41`、`src/dashboard/settings/__tests__/fieldValidation.test.ts:325`）が緑で、正規ホスト・IPv6・loopback の受け入れが壊れないこと
- [ ] `npm run validate` が緑であること

## テスト戦略

- 単体: `validateObsidianHost` に hex 形式（`0x7f000001` / `0x7f.0.0.1` / `0X7F.0.0.1`）を渡して拒否されることを pin。10進単独形（`2130706433`）と 8進形（`0177.0.0.1`）も拒否されることを **監査訂正の回帰 pin として** 明示的に残す。正規ホスト（`127.0.0.1` / `localhost` / `example.com` / `vault.example.com`）と IPv6（`::1`）が通ることも同時に pin。誤拒否ガードとして `0x7f000001.nip.io` を通すケースを 1 本加える。判定が URL パーサの解決結果と一致することを宣言するテストは「`new URL('https://' + host).hostname` が `127.0.0.1` になる入力は拒否される」という形でテストファーストに書く（source-only 実行で完結する。AGENTS.md の実時間待ち禁止に該当しない）
- 統合: `obsidianConfigBuilder` の `buildFromSettings` / `buildFromOverride` について、エンコード付きホストでは `baseUrl` が返らず Bearer 組み立て前に落ちることを確認。保存設定がエンコード付きである状態で `fetch` が 1 本も発行されないことを stub で pin。`savedObsidianOrigins` 導出が空集合になること（`CSPValidator.initializeFromSettings`）も既存 `obsidianHostCredentialPairing.test.ts:124-155` の describe に足す
- E2E: owner 観測（隔離プロファイル）。production data なしの隔離テストプロファイルで、`0x7f000001:27124` がローカルリスナへ届くかを**実際に観測**し、ローカルサービスがリクエストを受けたかを確認する。実測.host へのプローブはしない。E2E に実時間の sleep は入れず、リスナの readiness は上限つきポーリングで待つ（AGENTS.md の待機方針）

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認した行番号）

| ファイル | 行 | 現状 |
|---|---|---|
| `src/utils/obsidianConfigValidator.ts` | 84 | `validateObsidianHost` エントリ（entrypoint） |
| `src/utils/obsidianConfigValidator.ts` | 100-106 | IPv6 分岐。`:` を含む値は `isIpv6Address` に送られ `[::1]` 形式で返す |
| `src/utils/obsidianConfigValidator.ts` | 111-113 | `/[\s\/\\@%]/` 拒否（userinfo / percent エンコードの既存ガード） |
| `src/utils/obsidianConfigValidator.ts` | 117-122 | digit-dot ガード `/^[0-9.]+$/` → `isValidIpv4Address`。**10進単独形・8進形を既にここで捕まえている** |
| `src/utils/obsidianConfigValidator.ts` | 124-126 | `isValidDnsHostname` 検査。**Findings の穴はこの行**（`0x7f000001` / `0x7f.0.0.1` がここで通る） |
| `src/utils/obsidianConfigValidator.ts` | 134-145 | `isValidIpv4Address` — 4 オクテット必須。この制約が10進単独形の拒否理由 |
| `src/utils/obsidianConfigValidator.ts` | 152-159 | `isValidDnsHostname` のラベルパターン `/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/`。`x` を許容するため hex ラベルが通過する |
| `src/utils/obsidianConfigBuilder.ts` | 66 / 73 / 91 / 94 | `buildFromSettings` / `validateObsidianHost` 呼び出し / `baseUrl` 組み立て / `Authorization: Bearer` |
| `src/utils/obsidianConfigBuilder.ts` | 111 / 114 / 130 / 133 | `buildFromOverride`（接続テスト）/ host 検証 / `baseUrl` / Bearer |
| `src/background/obsidianClient.ts` | 305-306 | `_writeContent` — `fetchWithTimeout(url, { method:'PUT', headers, body })`（sink） |
| `src/background/obsidianClient.ts` | 274-275 | `_fetchExistingContent` — GET。同じ URL 解決結果に従う |
| `src/background/obsidianClient.ts` | 356 | `_fetchConnectionResponse` — 接続テスト GET（3 つ目のサイト） |
| `src/utils/ssrfGuard.ts` | 12-19 | `BLOCKED_PATTERNS`。`/^0x7f\./i` は.hex ドット形のみをカバーし、**`0x7f000001`（ドット無し）はカバーしない** |
| `src/utils/ssrfGuard.ts` | 49 / 63-67 | `BLOCKED_PATTERNS` のループは `if (blockLocalhost)` 内にあり、`blockLocalhost:false` の Obsidian 経路では**構造的に発動しない** |
| `src/utils/fetch.ts` | 105 / 112 | `blockLocalhost = false` の既定と `validateUrl(url, { requireValidProtocol, blockLocalhost })` 呼び出し |
| `src/utils/cspValidator.ts` | 109 | `savedObsidianOrigins` の宣言 |
| `src/utils/cspValidator.ts` | 186-200 | 保存 vault origin の導出（`:193` `validateObsidianHost`、`:195-197` `new URL(...).origin`） |
| `src/utils/cspValidator.ts` | 259 / 288 | `isUrlAllowed` 定義 / `savedObsidianOrigins.has(parsed.origin)` |
| `src/utils/cspValidator.ts` | 395 | リセット（`Set` を空に戻す） |
| `src/utils/storage/providerAllowlist.ts` | 307 | `isAllowedProviderBaseUrl`（デコード族の置き場所） |
| `src/utils/storage/providerAllowlist.ts` | 319-333 | `isBlockedIPv4` ローカルヘルパ |
| `src/utils/storage/providerAllowlist.ts` | 336-372 | `decodeNumericIPv4` — 10進整数 / hex 整数 / ドット付き hex・8進の 3 系統。**本 PBI が mirror すべき既存実装** |
| `src/utils/storage/providerAllowlist.ts` | 375-376 | デコード結果のブロック判定（`isBlockedIPv4` を通す） |
| `src/dashboard/settings/fieldDescriptor.ts` | 96-103 | `validateObsidianHostValue` — `validateObsidianHost` へ委譲（single ownership）。dashboard の保存 UI 側の入口 |

既存テストの置き場所:
- `src/utils/__tests__/obsidianHostCredentialPairing.test.ts:94-122`（`validateObsidianHost substantive validation` describe — 受け入れ/拒否ケースの主置き場）
- `src/utils/__tests__/obsidianHostCredentialPairing.test.ts:124-155`（`saved-Obsidian-origin CSP gate` describe — `savedObsidianOrigins` 導出の検証）
- `src/utils/__tests__/obsidianProtocolLoopback.test.ts:29-41`（userinfo bypass guards）
- `src/dashboard/settings/__tests__/fieldValidation.test.ts:325`、`src/dashboard/settings/__tests__/fieldDescriptor.test.ts:145-147`（dashboard 側の委譲確認）

### 最小変更の選択肢

1. **`validateObsidianHost` で IPv4 表現可能なエンコードラベルを拒否する（`ssrfGuard` / `providerAllowlist` の既存デコード族を Write する形で Mirroring）** — 推奨。`providerAllowlist.ts:336-372` の `decodeNumericIPv4` はローカル関数なのでそのままでは共有できないが、同じ3系統（10進整数 / hex 整数 / ドット付き hex・8進）を `src/utils/` の共有ヘルパへ移す形が素直。判定は「ホスト**全体**が4オクテット IPv4 に解決しうる形」だけに絞り、`0x7f000001.nip.io` を巻き込まないこと（実測済み）。変更は `obsidianConfigValidator.ts` に閉じる。
2. **検証器の判定と URL パーサの解決結果が一致することを、Bearer を付ける前に必須にする（`new URL` で再解釈してから照合）** — `obsidianConfigBuilder.ts:91` と `:130` の `baseUrl` 組み立て後に `new URL(baseUrl).hostname` を検証器の判定と突き合わせる。hex 形=April 生涯に型レベルではなく実行時の do-not-care になるため、`baseUrl` に `Authorization` を結線する前に失敗させる。これは 1 の**互补**で、単独でも防御になるが、判定基準が「パーサが 127.0.0.1 に落としたか」になるため将来の parser 挙動変化に追随する副作用がある。

**推奨: 選択肢 1 を必須とし、選択肢 2 を同じ変更で併せて入れる（deep defense）。** 1 単体でも BDD シナリオ 1/2/5 を満たす。2 を入れる場合は `buildFromOverride` にも同じチェックを適用し、接続テスト経路だけ緩まないことをテストで固定する。

### 監査記録の訂正（実装時に必ず引き継ぐ点）

> Correction to hunter evidence: the pure-decimal form `2130706433` is rejected at source (digit-dot guard at `src/utils/obsidianConfigValidator.ts:117-122` routes it to `isValidIpv4Address`, which requires 4 octets), so only the hex-bearing forms pass.

- 本 PBI の対象は **hex 含有形（`0x7f000001` / `0x7f.0.0.1`、および大文字 `0X` 変種）** のみ。10進単独形と 8進形は本 PBI の**対象外**（既に拒否済み）。
- ただし「対象外」は「テストしない」ではない。監査の訂正が将来コードで覆tegライトしないよう、10進形・8進形が拒否され続けることを**回帰 pin** として残すこと。
- 同様に `ssrfGuard.ts:16` の `/^0x7f\./i` は hex ドット形しか捕まえない。`0x7f000001`（ドット無し）をdecided的に拒否するには Patterns 側の拡張か、選択肢 1 のデコード判定が必要になる。

### ファイル競合回避（PBI 08 との together 実装）

PBI 08（Obsidian 経路の redirect ガード）と**同一ファイル群**（`src/background/obsidianClient.ts`、`src/utils/cspValidator.ts`、テスト）を触る。together 実装の推奨 hunk 分割:

- 本 PBI の hunk（`obsidianConfigValidator.ts` の拒否規則 + `obsidianConfigBuilder.ts` の再解釈チェック）を先に。
- PBI 08 の hunk（`obsidianClient.ts` の `redirect:'error'` 3 箇所）を後に。
- together 実装時の検証: `npx vitest run src/utils/__tests__/obsidianHostCredentialPairing.test.ts src/utils/__tests__/obsidianProtocolLoopback.test.ts src/background/__tests__/obsidianClient.test.ts --repeats=20 --retries=0`。
- together 実装時の記録: 同じ `src/utils/cspValidator.ts` 由来の導出経路を持つため、どちらを先に閉じてもう一方が緑であることを確認する。

### ブロッカー（着手前に潰すべき owner 確認）

1. **`new URL()` の実行時挙動の実ブラウザ観測** — 本 PBI の source-only 実行（Node WHATWG パーサ）では `0x7f000001` / `0x7f.0.0.1` / `0X7F.0.0.1` がいずれも `127.0.0.1` に再解釈されることを確認済み。**残る未観測事実は (a) Chromium/Extension service worker 上のパーサが Node と同じ解決を返すか、(b) その解釈先に実際にリスナがいるか**。needs_validation の留保理由もここ。production data を使わない隔離プロファイルで owner が観測し、非テスト対象へのプローブは行わない。
2. **settings 汚染経路の到達性** — cross-principal チェーンには settings 汚染（dashboard XSS の既知限界）が必要条件。ソース上 `OBSIDIAN_HOST` は拡張内専用設定（`src/dashboard/settings/fieldDescriptor.ts:171` が storageKey を宣言）であり、低信頼 principal が書き込める経路は未確定。owner が「到達可能な経路があるか」を確認し、無い場合でも本 PBI は**多層防御の1枚**として実装してよい（影響評価の断定に使わない）。
3. **`0x` を含む正当 DNS 名を誤拒否してよいか** — `0x7f000001.nip.io` のように実在するワイルドカード DNS サービスがあり得る。選択肢 1 の判定を「ホスト全体が IPv4 に解決しうる形」に絞れば通る（実測済み）。運用上の許容方針を owner が 1 行で示すこと。

いずれも owner 確認として本 PBI の冒頭に置き、実装着手の前に対応する（source-only 実行境界のもと未確認のまま「直した」としない）。

### ロールバック手順

1. 変更は `src/utils/obsidianConfigValidator.ts`（拒否規則）と `src/utils/obsidianConfigBuilder.ts`（再解釈チェック）、および together 実装した場合は共有デコードヘルパの配置先に限定する。
2. ロールバックは上記 hunk を戻すだけで足りる（設定・ストレージ・manifest・ストレージスキーマの変更を含まないためデータ移行は不要）。
3. 「正当な vault ホストが保存できなくなった」という報告を受けた場合、まず誤拒否がシナリオ 5 の `0x….<domain>` ケースか digit-dot ガードとの衝突かを切り分け、判定を「ホスト全体が IPv4 に解決しうる形」へ狭める。狭め直しも上記 hunk 内の変更に閉じる。
4. 回帰が疑われる場合は、単体 describe（`obsidianHostCredentialPairing.test.ts:94-122` の受入ケース列）を単発実行し、正規 5 ホスト + IPv6 2 形が通ることを確認する。

## 見積もり

0.1 SP（人週 0.5 日）。ブロッカー owner 確認（0.5 時間）→ 選択肢 1 の拒否規則と選択肢 2 の再解釈チェック（1-2 時間）→ BDD シナリオ 6 本の自動テスト（2-3 時間）→ `npm run validate` とレビュー（1-2 時間）。PBI 08 と together 実装する場合の追加はゼロ（同一ファイル群だが hunk は非重複）。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint を完了記録に残す（`0ee29ec604d1788f7f73156689eeddf065be733a861cd5924f7c776636f8d19c`）
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/SECURITY_REVIEW_GUIDE.md` の SSRF / CWE-918 脅威モデルに「validator と URL パーサの解決一致」項目を追記）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所実測）
- 決め手: Node の WHATWG URL で `0x7f000001` / `0x7f.0.0.1` / `0X7F.0.0.1` がいずれも `127.0.0.1` に再解釈され、現行 `validateObsidianHost` はこれらを受理する。10 進単独形 `2130706433` と `0177.0.0.1` は拒否される（監査の訂正どおり）。一方 **`0x7f000001.nip.io` は再解釈されない**ため、「ラベルに 0x を含む」ではなく「ホスト全体が IPv4 に解決しうる形」で判定する必要がある
- 影響: Chromium は Node と同じ URL 標準を実装するため信頼度は高い。誤拒否ガード（正当な DNS 名を巻き込まない）の受け入れ基準が必須

## 関連

- `pbi/00-INDEX.md`
- PBI 08（Obsidian 経路の redirect ガード）— 実装時に together できるか検討（同一ファイル群。hunk は非重複）
- `src/utils/storage/providerAllowlist.ts:336-372`（`decodeNumericIPv4` — mirror 元）
- `src/utils/ssrfGuard.ts:12-19`（`BLOCKED_PATTERNS` — 比較対象。ただし Obsidian 経路では発動しない）
- `dev-docs/SECURITY_REVIEW_GUIDE.md` — SSRF / CWE-918 の脅威モデル
- `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（findings.json `$[1]` / NEEDS-VALIDATION.md 1番）