# PBI: DomainFilter の blacklist mode 反転バグ修正 — isAllowedCached と CacheAdapter に mode を thread する

## ユーザーストーリー
ドメインフィルタでブラックリスト運用するユーザーとして、ブロックリストに入れたサイトが記録されないようにしたい、なぜなら現在 `DomainFilter.isAllowedCached()` と `DomainFilterCacheAdapter.isAllowed()` が `DOMAIN_FILTER_MODE` を参照せず常に allowlist として `cachedDomains.some(...)` を評価するため、blacklist mode でブロック対象 URL が `allowed: true` と反転して記録されてしまい、ドメインフィルタという主要なユーザー制御が機能不全に陥っているから

## 優先度
- 順位: 04 / 07（Architecture Deepening 0903 の追加発見、branch `0902a` レビュー由来）
- RICEスコア: **5.4**（Reach=1 / Impact=3 / Confidence=0.9 / Effort=0.5）
  - Reach 1: 毎記録時の engagement 判定で実行される（全ページ記録に影響、high）
  - Impact 3: 圧倒的 — ドメインフィルタはユーザーが制御できる主要なブロックリストであり、反転するとブロック対象サイトが記録される実害
  - Confidence 0.9: `src/utils/domainFilter/DomainFilter.ts:113` および `:152` のコードパスを特定済み、再現は mode を切り替えての unit test で確定可能
  - Effort 0.5: cache + adapter + mode threading + tests（0.5人週）
- 根拠: `Score = (1 * 3 * 0.9) / 0.5 = 5.4`。DomainFilter は `2026-09-03-06-refactor-domain-filter-unification` で統合された直後であり、同 PBI の DoD は満たすが本バグは統合後の cache 経路に残存した論理反転。修正は mode の thread のみで blast radius は小さいが correctness は critical。

## 背景 / なぜなぜ分析
- 表層: `src/utils/domainFilter/DomainFilter.ts:113` の `isAllowedCached()` が `cached.allowedDomains.some(pattern => hostname matches pattern)` を mode 非依存で評価する。`cachedDomains` は `buildCacheDomains()` で blacklist mode 時は `DOMAIN_BLACKLIST` を格納するが、述語は allowlist 前提のままのため `blacklisted URL → allowed: true` に反転する。同一バグが `DomainFilterCacheAdapter.isAllowed()` の TTL cache hit パス `src/utils/domainFilter/DomainFilter.ts:152` にも存在する
- なぜ1: なぜ反転に気づかなかったか → `DomainFilter` 統合時に `buildCacheDomains()` の blacklist 分岐は修正された（空配列 TODO は解消）が、`isAllowedCached` / `CacheAdapter.isAllowed` の read 側述語は allowlist 専用の `some(...)` のまま残置された。live read の `isAllowed()` は `isDomainAllowedLive()` に委譲して正しく mode 分岐するため、TTL miss 時は正しく動く
- なぜ2: なぜ cache hit 時のみ発現するか → TTL hit 時は `chrome.storage` / `cachedAt` の cache を直接評価して live に fallback しない。TTL 内（既定 5分）の間は反転結果が返り続け、TTL 外で live に fallback したときのみ正しい結果に戻るという間欠的な不具合
- なぜ3: なぜ 2 箇所に重複するか → `isAllowedCached(url, cached)` と `DomainFilterCacheAdapter.isAllowed(url)` が同一の `some(...)` ロジックをコピペで持ち、共通の `isDomainInList(hostname, list)` ヘルパに抽出されていない。片方を直してももう片方が残る構造
- なぜ4: なぜ adapter parity が必要か → `DomainFilter`（background live + isAllowedCached）と `DomainFilterCacheAdapter`（content-script TTL cache）の2 adapter が同じ `isAllowed` interface を満たすことが `2026-09-03-06` の BDD で保証されたが、parity テストが mode 別に存在しないため反転が検出されなかった
- 解: active mode を cache lookup に thread し、blacklist mode では `!isDomainInList(hostname, cachedDomains)` を、allowlist mode では現行の `isDomainInList(...)` を返す。両メソッドに適用し、共通ヘルパ `isDomainInList` に抽出して重複を解消する

## BDD受け入れシナリオ

### Scenario: allowlist mode — リスト内は許可、リスト外は拒否（happy path）
  Given `DOMAIN_FILTER_MODE='whitelist'` かつ `DOMAIN_WHITELIST=['example.com', '*.trusted.org']` である
  When `DomainFilter.isAllowedCached('https://example.com/page', cached)` を `cached = { allowedDomains: ['example.com','*.trusted.org'], cachedAt: now }` で呼ぶ（TTL内）
  Then `https://example.com/page` は `allowed: true` を返す
  And  `https://other.com/page` は `allowed: false` を返す
  And  `https://sub.trusted.org/page` は wildcard にマッチして `allowed: true` を返す

### Scenario: blacklist mode — リスト内は拒否、リスト外は許可（happy path）
  Given `DOMAIN_FILTER_MODE='blacklist'` かつ `DOMAIN_BLACKLIST=['blocked.com', '*.evil.net']` である
  When `DomainFilter.isAllowedCached('https://blocked.com/page', cached)` を `cached = { allowedDomains: ['blocked.com','*.evil.net'], cachedAt: now }` で呼ぶ（TTL内）
  Then `https://blocked.com/page` は `allowed: false` を返す
  And  `https://sub.evil.net/page` は wildcard にマッチして `allowed: false` を返す
  And  `https://allowed.com/page` はリスト外のため `allowed: true` を返す

### Scenario: cache hit が mode を保持する — blacklist で blacklisted ドメインの cache hit は常に拒否
  Given `DOMAIN_FILTER_MODE='blacklist'` で `DomainFilter`（`ttlMs=5*60*1000`）が `cached = { allowedDomains: ['blocked.com'], cachedAt: Date.now() }` を持つ
  When TTL内の `isAllowedCached('https://blocked.com/page', cached)` を呼ぶ
  Then 結果は `allowed: false` である（cache hit でも反転せず、TTL hit が mode を正しく反映する）
  And  TTL外（`cachedAt` が `ttlMs` 超過）では live の `isDomainAllowedLive` に fallback し、同様に `allowed: false` が得られる

### Scenario: adapter parity — DomainFilterCacheAdapter.isAllowed が DomainFilter.isAllowedCached と両 mode で一致する
  Given 同一の `ttlMs` と同一の `allowedDomains` / `DOMAIN_FILTER_MODE` で `DomainFilter` と `DomainFilterCacheAdapter` を用意する
  When allowlist mode で `DomainFilter.isAllowedCached(url, cached)` と `adapter.isAllowed(url)`（事前に `adapter.updateCache(allowedDomains)` 済み）を同じ URL 集合で呼ぶ
  Then 両者の戻り値は全 URL で一致する
  When blacklist mode でも同様に両者を呼ぶ
  Then 両者の戻り値は全 URL で一致する（blacklisted は `false`、unlisted は `true`）

## 受け入れ基準
- [ ] `DomainFilter.isAllowedCached()` が active mode（`DOMAIN_FILTER_MODE` または引数で thread された mode）を参照し、blacklist mode では `!isDomainInList(hostname, cachedDomains)` を、allowlist mode では `isDomainInList(...)` を返す
- [ ] `DomainFilterCacheAdapter.isAllowed()` の TTL cache hit パス（`src/utils/domainFilter/DomainFilter.ts:152` 相当）が同様に mode を参照し、blacklist では否定、allowlist では肯定で返す
- [ ] 共通ヘルパ `isDomainInList(hostname, list)`（または `matchesDomainList` 等）に wildcard 判定（`wildcardToRegex` 単一エンジン）が抽出され、2箇所の `some(...)` 重複が解消している
- [ ] `buildCacheDomains()` / `cache()` の既存の mode 別 cache 生成は維持され、blacklist mode で `DOMAIN_BLACKLIST` が正しくキャッシュされる
- [ ] 既存の `DomainFilter` / `domainFilterCache` / `wildcardToRegex` 関連テストが green のままである
- [ ] `npm run validate`（type-check + tests）が green

## テスト戦略
- 単体: `DomainFilter.isAllowedCached` の allowlist mode テスト — listed `true` / unlisted `false` / wildcard マッチ `true` を TTL内 cache で検証（`ttlMs: 100` の短い TTL インスタンスで `Date.now()` を固定または fake timer）
- 単体: `DomainFilter.isAllowedCached` の blacklist mode テスト — listed `false` / wildcard listed `false` / unlisted `true` を TTL内 cache で検証
- 単体: cache hit が mode を保持することの検証 — blacklist mode で `blocked.com` の cache hit が `false` を返すこと、TTL外では live fallback が同結果を返すことを検証
- 単体: `DomainFilterCacheAdapter.isAllowed` の parity テスト — 同一 `allowedDomains` と mode で `DomainFilter.isAllowedCached` と `adapter.isAllowed` の結果が全 URL で一致することを allowlist / blacklist の両方で検証（`adapter.updateCache()` 後の TTL内 hit パス）
- 単体: TTL 境界テスト — `ttlMs` を construction param で注入し、TTL内は cache、TTL外は live に fallback することを fake timer で検証
- 回帰: 既存の `tests/domainFilter*` / `wildcardToRegex` / `domainUtils` テストを新 seam 経由で実行し green を確認

## 見積もり
1 pt（🟢低、0.5人週）— cache + adapter + mode threading + tests

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `src/utils/domainFilter/DomainFilter.ts:113` と `:152` の両 cache hit パスが mode 分岐を持ち、`grep` で `some(pattern` の重複が共通ヘルパに収束している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（必要なら `dev-docs/DESIGN_SPECIFICATIONS.md` の DomainFilter 節に mode 別 cache 述語を追記）
- [ ] `npm run validate` green

## 実装メモ（任意）
- mode の thread 方法は `isAllowedCached(url, cached, mode?)` に `mode` 引数を追加するか、`DomainFilter` / `DomainFilterCacheAdapter` の construction param / settings snapshot から読むかのいずれか。`buildCacheDomains(settings)` が既に `settings[StorageKeys.DOMAIN_FILTER_MODE]` を読むため、同様に `isAllowedCached` も `chrome.storage` または渡された `Settings` から mode を取得する形が整合的
- 共通ヘルパは `private isDomainInList(hostname: string, list: string[]): boolean` として `wildcardToRegex` を内部で呼び、`*.` 前方一致と `*` wildcard を単一エンジンで処理する。blacklist では `return !isDomainInList(...)` とする
- `DomainFilterCacheAdapter` は `filter.getTtlMs()` から TTL を継承しているため、TTL の construction param 化は既存の `2026-09-03-06` で実現済み。mode のみを追加で thread すればよい
- 修正対象ファイルは `src/utils/domainFilter/DomainFilter.ts` のみ。`src/utils/domainUtils.ts` の live `isDomainAllowed` は正しく mode 分岐済みのため変更不要
