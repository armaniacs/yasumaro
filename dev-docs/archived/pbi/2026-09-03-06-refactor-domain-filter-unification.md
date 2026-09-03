# PBI: DomainFilter 統合 — 4 gates / 3 wildcard エンジンを単一 deep module に

## ユーザーストーリー
ドメインフィルタを保守する開発者として、`isDomainAllowed`（live read）/ `domainFilterCache`（5分 TTL）/ `dashboard domainFilter`（textarea + toggles）/ `content extractor`（callback cache）の4箇所と 3つの wildcard エンジンを単一の deep module `DomainFilter` に統合したい、なぜなら現在は同じ問い「このURLは許可か？」に別 staleness・別 wildcard 実装で答え、ReDoS guard が重複し blacklist mode の cache は空のまま（TODO）で、パターン型追加が4箇所の同時更新を要するから

## 優先度
- 順位: 06 / 07
- RICEスコア: **58**（Reach=50 / Impact=1 / Confidence=0.7 / Effort=0.6）
- 根拠: 全ページの記録可否判定に影響（Reach 50）。現状でも `isDomainAllowed` の live read が正しく動くため致命的な不具合は回避済み（Impact 1）。パターン型追加や ReDoS 修正のたびに4箇所を触るコストが累積している。Effort 0.6人週は wildcard 一本化＋cache adapter＋dashboard hidden textarea の module 隠蔽を含む。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 4箇所が同じ問いに答える？ | `domainUtils.isDomainAllowed`（background live）、`domainFilterCache`（content 5分 TTL）、`dashboard/settings/domainFilter.ts`（textarea ↔ STORAGE）、`content loader`（callback）がそれぞれ独自にフィルタリングを実装 → `DomainFilter.isAllowed(url)` を唯一の seam にし各 context は adapter で利用 |
| なぜ wildcard が3つ？ | `matchesPattern` / `matchesWildcardPattern` / `isUrlBlocked`（uBlock matcher）が別実装で ReDoS guard（`MAX_WILDCARDS_PER_PATTERN` / `wildcardToRegex`）が `domainUtils` と `wildcardToRegex.ts` に重複 → `wildcardToRegex` に一本化し guard を1箇所に |
| なぜ blacklist cache が空？ | `updateDomainFilterCache` の blacklist 分岐が `cachedDomains = []` の不完全実装でコメントに「別途ブロックドメインキャッシュが必要」と記載 → `DomainFilter.cache(validFor)` が mode に応じて正しいキャッシュを生成 |
| なぜ 1 adapter では hypothetical か？ | Content-script 向け cache adapter がなければ `DomainFilter` は1つの実装しか持たず seam が仮説的 → `DomainFilterCacheAdapter` を2つ目の adapter として用意し seam を実在化（one adapter = hypothetical, two = real） |

## BDD受け入れシナリオ

### Scenario: 単一 seam で全 context のフィルタリングが動く
  Given `DomainFilter` が `isAllowed(url)` / `parse` / `validate` / `cache(validFor)` を持つ
  When background の `isDomainAllowed` / content script の `getDomainFilterCacheSync` / dashboard の textarea 保存のいずれからも `DomainFilter` の seam を通して判定する
  Then 全 context で同じ wildcard エンジンと ReDoS guard で同一結果が得られる

### Scenario: wildcard エンジンが一本化される
  Given `wildcardToRegex` が唯一の wildcard 実装である
  When `grep -r "matchesPattern\|matchesWildcardPattern\|isUrlBlocked" src/` を実行する
  Then 3つの別実装は存在せず、全てが `wildcardToRegex`（または `DomainFilter` の wrapper）に一本化されている

### Scenario: blacklist mode の cache が正しく生成される
  Given `DomainFilter.cache(validFor)` が `DOMAIN_FILTER_MODE` に応じてキャッシュを生成する
  When mode が `blacklist` のとき
  Then `cachedDomains` が空ではなく、ブロックドメインが正しくキャッシュされ、content script でも blacklist 判定が機能する

### Scenario: content-script 向け adapter が 2つ目の adapter として機能する
  Given `DomainFilter`（live read）と `DomainFilterCacheAdapter`（5分 TTL cache）が同じ `isAllowed` interface を満たす
  When content script が `DomainFilterCacheAdapter` を使う
  Then `chrome.storage.local.get` の callback で cache を読み、TTL 内は cache hit、TTL 外は `DomainFilter` に fallback する

### Scenario: TTL が construction param で制御される
  Given `DomainFilter` の TTL が construction param（例: `new DomainFilter({ ttlMs: 5*60*1000 })`）で注入される
  When テストで `ttlMs: 100` の短い TTL でインスタンスを作る
  Then TTL 境界のテストが timer 進行なしで検証できる

## 受け入れ基準
- [x] `DomainFilter`（または `src/utils/domainFilter.ts` 等の単一 module）が `isAllowed(url)` / `parse` / `validate` / `cache` の interface を持ち、4箇所のフィルタリングロジックが統合されている
- [x] `wildcardToRegex` が唯一の wildcard 実装として一本化され、`matchesPattern` / `matchesWildcardPattern` / `isUrlBlocked` の重複が削除されている（`grep` で 3 実装が 1 に）
- [x] `updateDomainFilterCache` の blacklist 分岐の不完全実装（空配列）が解消され、blacklist mode でも正しい cache が生成される
- [x] `DomainFilterCacheAdapter`（content-script 向け）が 2つ目の adapter として存在し、同一 `isAllowed` interface を満たす
- [x] TTL が construction param または module 定数として外から制御可能
- [x] 既存の `isDomainAllowed` / `domainFilterCache` / `dashboard domainFilter` / `content extractor` テストが新 seam 経由で green、`npm run validate` green

## テスト戦略
- 単体: `DomainFilter.isAllowed` の whitelist / blacklist / disabled / uBlock の全 mode 組合せを InMemory settings で検証
- 単体: `wildcardToRegex` の ReDoS guard（`MAX_WILDCARDS_PER_PATTERN` 超過で拒否）を unit test
- 単体: `cache(validFor)` の blacklist / whitelist / disabled の各 mode での cache 生成を検証
- 統合: `DomainFilterCacheAdapter` の TTL hit / miss / fallback を fake `chrome.storage.local` で検証
- 回帰: 既存の `domainUtils` / `domainFilterCache` / `wildcardToRegex` テストを新 seam に移行し green

## 見積もり
2 pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `grep` で wildcard 実装が 1 箇所に収束し、4 gates の重複ロジックが削除されている
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` の DomainFilter 節を新 module 前提に更新）
- [x] `npm run validate` green

## 実装メモ（任意）
- ファイル配置は `src/utils/domainFilter/DomainFilter.ts` + `DomainFilterCacheAdapter.ts` + `wildcardToRegex.ts` のサブディレクトリも検討。既存の `src/utils/domainUtils.ts` は facade として残しつつ新 module に委譲する形でも可。
- Dashboard の hidden textarea trick（`SIMPLE_FORMAT_ENABLED` / `UBLOCK_FORMAT_ENABLED` toggles）は `DomainFilter` が隠蔽し、dashboard は `DomainFilter.parse(textareaValue)` のみを呼ぶ形に。
