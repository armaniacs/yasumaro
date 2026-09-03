# PBI: SSRF Allowlist Bypass 修正 — isAllowedProviderBaseUrl の私的・ループバック・リンクローカル・エンコード迂回の封鎖

## ユーザーストーリー
AIプロバイダーURLを設定するユーザーとして、`isAllowedProviderBaseUrl` が私的/ループバック/リンクローカルおよびエンコードされた迂回URLを確実に拒否してほしい、なぜなら現在の allowlist は `10.*` / `192.168.*` / `172.16-31.*` と単一IP `169.254.169.254` のみをブロックしており、`0.0.0.0` / `127.0.0.0/8` / `169.254.0.0/16` 全体 / 整数・16進エンコードIPv4 / `::1` / `::ffff:` / `fc00::/7` 経由で AWS/GCP メタデータサービス (`169.254.169.254`, `metadata.google.internal`) やローカルサービスへの SSRF と認証情報窃取が可能だから

## 優先度
- 順位: 01 / 緊急（0902a ブランチレビュー指摘の critical security finding）
- RICEスコア: **4.8**（Reach=1 × Impact=3 × Confidence=0.8 / Effort=0.5）
  - Reach=1 — 稼働時に登録される provider は通常1件だが、セキュリティ到達範囲は AI プロバイダー呼び出しの100%
  - Impact=3 — 圧倒的（overwhelming）— メタデータサービス経由の認証情報窃取・内部ネットワーク走査が可能
  - Confidence=0.8 — 迂回ベクターは確定、修正パターンは既知（IP 正規化 + 範囲ブロック）
  - Effort=0.5 — 関数書き換え + テスト拡充で0.5人週
- 根拠: 既存の `isAllowedProviderBaseUrl` (`src/background/ai/providerCatalog.ts:217`) がホスト名の文字列マッチのみで判定し、URL パース後の正規化・エンコード解決・IPv6 を一切考慮していない。1箇所の修正で SSRF クラス全体を封鎖できる。

## 背景 / なぜなぜ分析

| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ単一IPブロックでは不十分か？ | `169.254.169.254` の1点のみを拒否し、リンクローカル `169.254.0.0/16` の残り 65,534 アドレスを許可 → クラウドメタデータは別IPでも到達可能 → 範囲ブロックが必要 |
| なぜ `127.0.0.1` 以外のループバックが抜ける？ | `127.0.0.0/8` のうち `127.0.0.1` 以外（`127.0.0.2`, `127.1` など）をチェックせず、`0.0.0.0` も未ブロック → `http://127.0.0.2:11434/` で Ollama/LM Studio 迂回が可能 → CIDR 範囲で判定 |
| なぜ整数/16進エンコードが迂回になる？ | `2130706433` (= `0x7F000001` = `127.0.0.1`) を文字列として `10.*` 正規表現と照合してもマッチせず素通し → `URL.hostname` の数値解釈前に検出できない → 明示的に数値/hex を IPv4 にデコードしてから範囲判定 |
| なぜIPv6が抜ける？ | `::1`, `::ffff:127.0.0.1`, `fc00::/7` (ULA) を一切検査せず、`URL.hostname` が `[::1]` でも文字列マッチで素通し → IPv6 パースと v4-mapped 展開が必要 |
| なぜIDN/末尾ドットが境界条件か？ | `metadata.google.internal.`（末尾ドット）や `xn--` punycode が正規化なしで allowlist をすり抜ける可能性 → `hostname` を小文字化・末尾ドット除去・punycode 正規化してから判定 |

### 現状コードの確認（着手前必須）

```bash
grep -rn "isAllowedProviderBaseUrl" src/
# → src/background/ai/providerCatalog.ts:217 定義、呼び出し元を確認
grep -rn "169.254" src/ tests/
grep -rn "isPrivateIpAddress\|BLOCKED_PATTERNS" src/
```

既存実装（`src/background/ai/providerCatalog.ts:217-229`）：

```ts
export function isAllowedProviderBaseUrl(url: string, isLocal: boolean): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname;
    if (host === '169.254.169.254' || host === 'metadata.google.internal') return false;
    if (/^10\.\d+\.\d+\.\d+$/.test(host) || /^192\.168\.\d+\.\d+$/.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return false;
    if (!isLocal && parsed.protocol === 'http:' && host !== '127.0.0.1' && host !== 'localhost') return false;
    return true;
  } catch { return false; }
}
```

欠落: `0.0.0.0`, `127.0.0.0/8` 全体, `169.254.0.0/16` 全体, 整数/hex IPv4, `::1`, `::ffff:`, `fc00::/7`, IDN/punycode 正規化, 末尾ドット除去。

## BDD受け入れシナリオ

```gherkin
Scenario: Happy path — 公開URLは許可される
  Given 利用者が非ローカル provider の baseUrl として "https://api.openai.com/" を設定する
  When isAllowedProviderBaseUrl("https://api.openai.com/", false) が呼ばれる
  Then true が返る
  And isAllowedProviderBaseUrl("https://generativelanguage.googleapis.com/", false) も true が返る
  And isAllowedProviderBaseUrl("https://api.anthropic.com/v1", false) も true が返る

Scenario: Bypass blocked — メタデータサービス単一IPは拒否される
  Given 攻撃者が provider baseUrl に "http://169.254.169.254/" を設定する
  When isAllowedProviderBaseUrl("http://169.254.169.254/", false) が呼ばれる
  Then false が返る
  And isAllowedProviderBaseUrl("http://169.254.169.254/latest/meta-data/", false) も false が返る
  And isAllowedProviderBaseUrl("http://metadata.google.internal/", false) も false が返る
  And isAllowedProviderBaseUrl("http://metadata.google.internal./", false) も末尾ドット除去後に false が返る

Scenario: Bypass blocked — リンクローカル範囲全体が拒否される
  Given 攻撃者がリンクローカル範囲の別IPを使う
  When isAllowedProviderBaseUrl("http://169.254.10.20/", false) が呼ばれる
  Then false が返る
  And isAllowedProviderBaseUrl("http://169.254.1.1/", false) も false が返る
  And isAllowedProviderBaseUrl("http://169.254.0.1/", true) も isLocal=true でも false が返る

Scenario: Bypass blocked — ループバック範囲と 0.0.0.0 が拒否される
  Given 攻撃者がループバックの別表現を使う
  When isAllowedProviderBaseUrl("http://127.0.0.2/", false) が呼ばれる
  Then false が返る
  And isAllowedProviderBaseUrl("http://127.1.1.1/", false) も false が返る
  And isAllowedProviderBaseUrl("http://0.0.0.0/", false) も false が返る
  And isAllowedProviderBaseUrl("http://0.0.0.0:11434/v1", true) も false が返る

Scenario: Bypass blocked — 整数・16進エンコードIPv4が拒否される
  Given 攻撃者が数値エンコードでループバックを隠蔽する
  When isAllowedProviderBaseUrl("http://2130706433/", false) が呼ばれる
  Then false が返る（2130706433 = 127.0.0.1 として解釈）
  And isAllowedProviderBaseUrl("http://0x7f000001/", false) も false が返る
  And isAllowedProviderBaseUrl("http://0x7F.0.0.1/", false) も false が返る
  And isAllowedProviderBaseUrl("http://3232235521/", false) も false が返る（192.168.0.1）
  And isAllowedProviderBaseUrl("http://167772161/", false) も false が返る（10.0.0.1）

Scenario: Bypass blocked — プライベート範囲 10/8, 192.168/16, 172.16/12 が拒否される
  Given 攻撃者がプライベートIPを直接指定する
  When isAllowedProviderBaseUrl("http://10.0.0.1/", false) が呼ばれる
  Then false が返る
  And isAllowedProviderBaseUrl("http://192.168.1.1/", false) も false が返る
  And isAllowedProviderBaseUrl("http://172.16.0.1/", false) も false が返る
  And isAllowedProviderBaseUrl("http://172.31.255.255/", false) も false が返る

Scenario: Bypass blocked — IPv6 ループバック・マップド・ULA が拒否される
  Given 攻撃者がIPv6表現でループバック/私的アドレスを隠蔽する
  When isAllowedProviderBaseUrl("http://[::1]/", false) が呼ばれる
  Then false が返る
  And isAllowedProviderBaseUrl("http://[::ffff:127.0.0.1]/", false) も v4-mapped 展開後に false が返る
  And isAllowedProviderBaseUrl("http://[::ffff:10.0.0.1]/", false) も false が返る
  And isAllowedProviderBaseUrl("http://[fc00::1]/", false) も ULA として false が返る
  And isAllowedProviderBaseUrl("http://[fd00::1]/", false) も false が返る

Scenario: Boundary — IDN/punycode と末尾ドットは正規化後に判定される
  Given 攻撃者が末尾ドットや punycode で allowlist を迂回しようとする
  When isAllowedProviderBaseUrl("http://10.0.0.1./", false) が呼ばれる
  Then 末尾ドット除去後に false が返る
  And isAllowedProviderBaseUrl("http://metadata.google.internal./", false) も false が返る
  And isAllowedProviderBaseUrl("http://xn--example-9ta.com/", false) は punycode 正規化後に公開ドメインとして判定される
  And isAllowedProviderBaseUrl("https://api.openai.com./", false) は末尾ドット除去後に true が返る

Scenario: isLocal=false では http が原則拒否、isLocal=true では localhost のみ http 許可
  Given 非ローカル provider で http が使われる
  When isAllowedProviderBaseUrl("http://api.openai.com/", false) が呼ばれる
  Then false が返る（https のみ許可）
  And isAllowedProviderBaseUrl("http://localhost:11434/v1", true) は true が返る
  And isAllowedProviderBaseUrl("http://127.0.0.1:11434/v1", true) はループバックブロックにより false が返る（isLocal でも SSRF 範囲は拒否）
```

## 受け入れ基準
- [ ] `isAllowedProviderBaseUrl` が `0.0.0.0/8`（`0.0.0.0` を含む）を拒否する
- [ ] `127.0.0.0/8` 全体（`127.0.0.1` 以外の `127.0.0.2` / `127.1` / `2130706433` 等を含む）を拒否する
- [ ] `169.254.0.0/16` 全体（`169.254.169.254` 以外の `169.254.1.1` / `169.254.10.20` 等を含む）を拒否する
- [ ] 整数エンコード IPv4（例: `http://2130706433/` → `127.0.0.1`）をデコードして拒否する
- [ ] 16進エンコード IPv4（例: `http://0x7f000001/` / `http://0x7F.0.0.1/`）をデコードして拒否する
- [ ] IPv6 `::1`（`http://[::1]/`）を拒否する
- [ ] IPv4-mapped IPv6 `::ffff:0:0/96`（例: `http://[::ffff:127.0.0.1]/`）を v4 展開して拒否する
- [ ] ULA `fc00::/7`（`fc00::1` / `fd00::1`）を拒否する
- [ ] 既存の `10.0.0.0/8` / `192.168.0.0/16` / `172.16.0.0/12` ブロックが維持される
- [ ] `metadata.google.internal`（末尾ドット付き `metadata.google.internal.` を含む）を拒否する
- [ ] ホスト名が小文字化・末尾ドット除去・punycode 正規化（`URL.hostname` の挙動に準拠）された上で判定される
- [ ] 公開URL `https://api.openai.com/` / `https://generativelanguage.googleapis.com/` が `true` を返す（リグレッションなし）
- [ ] 不正なURL（`new URL()` が throw）は `false` を返す
- [ ] `npm run validate`（type-check + tests）が green、既存の providerCatalog / RemoteAIService テストが pass

## テスト戦略（t_wadaスタイル — Outside-In）

### E2Eテスト（最小限）
- ユーザーシナリオ: Dashboard の provider baseUrl 入力欄に `http://169.254.169.254/` / `http://2130706433/` / `http://[::1]/` を入力 → 保存が拒否されエラーメッセージが表示される（既存の `isAllowedProviderBaseUrl` 呼び出し経路を E2E で検証）

### 統合テスト（中程度）
- `RemoteAIService` / `createProviderStrategy` 経路で不正 baseUrl が渡された場合にリクエストが発行されずエラーが返ること
- `GenericOpenAICompatibleProvider` が `isAllowedProviderBaseUrl` に委譲して SSRF URL をブロックすること

### 単体テスト（多数 — 本PBIの主戦場）
- **正常系**: `https://api.openai.com/` / `https://generativelanguage.googleapis.com/v1` / `https://api.anthropic.com/` → `true`
- **境界値（IDN/ドット）**: `http://10.0.0.1./` / `http://metadata.google.internal./` / `https://api.openai.com./`（末尾ドット除去後の判定）、`http://xn--` 系 punycode
- **例外ハンドリング**: `""` / `"not a url"` / `"ftp://example.com"` / `"http://[invalid"` → `false`
- **整数エンコード**: `2130706433` (127.0.0.1), `3232235521` (192.168.0.1), `167772161` (10.0.0.1), `2852039166` (169.254.169.254)
- **16進エンコード**: `0x7f000001`, `0x7F.0.0.1`, `0xc0a80001` (192.168.0.1)
- **8進エンコード**（対応する場合）: `0177.0.0.1` 等 — 実装方針で要否を決定
- **IPv6**: `::1`, `::ffff:127.0.0.1`, `::ffff:10.0.0.1`, `fc00::1`, `fd00::1`, `fe80::1`（リンクローカル、任意で）
- **範囲ブロック**: `10.0.0.1`, `192.168.1.1`, `172.16.0.1`, `172.31.255.255`, `0.0.0.0`, `127.0.0.2`, `169.254.10.20`
- **プロトコル**: `http` vs `https` + `isLocal` の組み合わせ（`isLocal=false` で `http://api.openai.com` → `false`）

比率の目安: E2E:統合:単体 = 1:10:100。本PBIは単体テストを厚くする。

## 実装アプローチ
- **Outside-In**: まず BDD シナリオに対応する失敗テスト（RED）を `tests/background/ai/providerCatalog.test.ts`（または `isAllowedProviderBaseUrl` の既存テスト）に書く → `isAllowedProviderBaseUrl` を修正して GREEN → リファクタ
- **Red-Green-Refactor**: TDDサイクルを各迂回ベクターごとに回す（例: 0.0.0.0 → 127/8 → 169.254/16 → 整数/hex → IPv6 の順に垂直スライス）
- **リファクタリング**: GREEN 後に重複する範囲判定をヘルパー（例: `isPrivateIPv4`, `isLoopback`, `isLinkLocal`, `decodeNumericIPv4`, `isIPv6Blocked`）に抽出するが、外部 interface は `isAllowedProviderBaseUrl(url, isLocal)` 1関数のまま維持

### 推奨実装手順
1. `URL` パース後に `hostname` を正規化（小文字化 + 末尾 `.` 除去）。`parsed.hostname` は既に punycode 解決済みだが、末尾ドットは残るため `host.replace(/\.+$/, '')` が必要
2. `0.0.0.0/8`, `127.0.0.0/8`, `169.254.0.0/16` の範囲チェックを追加（既存の `10/8` 等と同列）
3. 整数・hex エンコード検出: ホストが `^\d+$` / `^0x[0-9a-fA-F]+$` / `^0x[0-9a-fA-F]+\.` 等にマッチする場合、32bit 整数としてデコードし 4 octets に分解して範囲判定（`Number` → `>>> 0` → octet 抽出）
4. IPv6 判定: `host` が `:` を含む場合、`::1` の完全一致、`::ffff:` prefix の v4 抽出、`fc00::/7`（先頭バイト `0xfc`/`0xfd`）をブロック。`URL.hostname` は `[::1]` から brackets を除去して返す点に注意
5. 既存の `metadata.google.internal` チェックは正規化後の host で再実施
6. `isLocal` の `http` 許可は SSRF 範囲ブロックの**後**に評価（`isLocal=true` でもループバック/リンクローカルは拒否）

### 落とし穴
- `new URL("http://2130706433/").hostname` は環境により `"2130706433"` のままか `"127.0.0.1"` に解決されるかが異なる — 両ケースをテストし、未解決なら自前デコードが必須
- `URL.hostname` は IPv6 の brackets を除去するが `URL.host` は含む — `hostname` を使うこと
- `0x7f000001` のような hex は `URL` が `hostname` として保持するが数値としては解釈しない — 自前で `parseInt(host, 16)` 的な分岐が必要
- `fetch` 側でも SSRF ガードがあるが、本PBIは providerCatalog の allowlist を single source of truth にする — 二重防御は維持しつつ判定はここに集約

## 見積もり
- ストーリーポイント: **3 pt**（要チームでの見積もり — RICE Effort 0.5人週に相当）
- 内訳: 関数書き換え 0.2w + 単体テスト拡充（30+ケース）0.2w + レビュー・リグレッション確認 0.1w

## 技術的考慮事項
- 依存関係: なし（`src/background/ai/providerCatalog.ts` 単独の pure function 修正。`chrome.*` API 依存なし）
- テスタビリティ: `isAllowedProviderBaseUrl` は pure function のため `chrome` mock 不要。`vitest` で直接呼び出し可能。既存テスト `tests/background/ai/providerCatalog.test.ts` があれば拡張、なければ新規作成
- 非機能要件:
  - セキュリティ: 本修正は SSRF の defense-in-depth の1層。`fetch` 側の `validateUrlForFilterImport` / `ssrfGuard` とは独立して機能すること
  - 性能: ホスト名の正規化・数値デコードは定数時間、パフォーマンス影響なし
  - 互換性: `isLocal=true` のローカル provider（Ollama `http://localhost:11434` / LM Studio `http://127.0.0.1:1234`）の挙動に注意 — `localhost` は許可、`127.0.0.1` は SSRF 観点で拒否すべきか判断が必要。本PBIの受け入れ基準では `127.0.0.1` は isLocal でも拒否とするが、既存の `lm-studio` defaultBaseUrl `http://127.0.0.1:1234/v1` との整合はチームで要確認（必要なら `isLocal` の例外を ADR に記録）
- 影響範囲: AI プロバイダー全呼び出し（`RemoteAIService` → `GenericOpenAICompatibleProvider` / `GeminiProvider`）。`lm-studio` / `ollama` のローカル利用が誤ブロックされないよう `isLocal` 分岐のテストを必須とする

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rn "isAllowedProviderBaseUrl" src/ tests/
grep -rn "PROVIDER_CATALOG\|isLocal" src/background/ai/
# 呼び出し元: src/background/ai/RemoteAIService.ts 等で isAllowedProviderBaseUrl が使われているか確認
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。本PBIは `0902a` ブランチレビューで発見された**未修正の脆弱性**であり、現行 `main` の `providerCatalog.ts:217` は依然として vulnerable な状態であることを確認済み。

### ロールバック手段
本変更は allowlist を**狭める**（より多くを拒否する）変更のため、誤ブロック（false positive）が発生した場合の切り戻し手段を用意する:
- `isAllowedProviderBaseUrl` の旧実装をコメントで残すか、feature flag で旧判定に切り戻せるようにする（任意）
- 誤ブロック報告時の暫定対応として、ブロックされた URL をログに出す（PII なしの host のみ） — `logger` で `WARN` レベル

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（`http://169.254.169.254/` / `http://2130706433/` / `http://[::1]/` / `http://10.0.0.1/` を含む全迂回ベクターが `false`）
- [ ] 末尾ドット・punycode 正規化の境界値テストが pass する
- [ ] `https://api.openai.com/` の happy path が pass する（リグレッションなし）
- [ ] テストカバレッジが基準を満たす（単体テスト 30+ケース、E2E/統合が各1以上）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は `SECURITY_REVIEW_GUIDE.md` の観点確認をPR説明に明記）
- [ ] リファクタリング完了（GREEN 後にヘルパー抽出・重複除去）
- [ ] ロールバック手段の検討を記載済み（本PBIの「実装者向け注記」参照）
- [ ] ドキュメント更新済み（必要なら `dev-docs/ARCHITECTURE_MAP.md` / ADR に SSRF ガードの仕様を追記）
- [ ] `npm run validate`（type-check + lint + tests）が green

