# PBI: RecordingCache 分割 — 3 TTLs を 3つの typed cache に、redact を StoragePort decorator に

## ユーザーストーリー
記録キャッシュを保守する開発者として、`RecordingCacheInstance` の 433l 1クラスに同居する 3つの TTL cache（settings 30s / url 60s / privacy 5m）を 3つの typed cache module に分割したい、なぜなら現在は 1つの `CacheState` と `saveQueueScheduled` microtask と `chrome.storage.onChanged` listener と `redactSettingsApiKeys`（VULN-014）が1クラスに混在し、cross-context invalidation が脆弱で TTL 変更が他 cache に波及するから

## 優先度
- 順位: 05 / 07
- RICEスコア: **80**（Reach=50 / Impact=1 / Confidence=0.8 / Effort=0.5）
- 根拠: 全記録の cache hit/miss に影響するが、現状でも eager invalidation で致命的な不具合は回避済み（Impact 1）。PBI 01/03 とは独立して着手可能だが、01 完了後の方が storage 層の安定により cache 永続化の修正が安全。Effort 0.5人週は 3 cache 分割＋facade 維持＋redact 移動。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 1クラスに3 TTL が混在？ | `CacheState` が `settingsCache` / `urlCache` / `privacyCache` と各 timestamp / version を1オブジェクトに持ち、`scheduleCacheSave()` が1つの microtask で全 cache をまとめて永続化 → 各 cache を `get / set / invalidate / isStale` の小さい interface を持つ module に分割 |
| なぜ cross-context invalidation が脆弱？ | `ensureStorageListener()` が `chrome.storage.onChanged` を登録するが deregister せず、`invalidateSettingsCache()` は settings のみをクリアし privacy は per-url timestamp のみ → 1箇所で購読し 3 cache に broadcast する facade に |
| なぜ redact が cache に？ | VULN-014 の `redactSettingsApiKeys` が cache の `saveCacheToSession()` 内で呼ばれる → `StoragePort` decorator に移動し cache module は redact を知らない |
| なぜ TTL 分岐が複雑？ | `loadCacheFromSession()` が 3つの TTL を個別にチェックする分岐の塊 → 各 cache が自身の TTL と stale 判定を own し facade は委譲のみ |

## BDD受け入れシナリオ

### Scenario: 3つの cache が独立した module として存在する
  Given `SettingsCache`（30s）/ `UrlCache`（60s）/ `PrivacyCache`（5m）がそれぞれ `get / invalidate / isStale` の interface を持つ
  When `RecordingCacheInstance` が 3 cache を compose する facade として再構成される
  Then TTL 変更が該当 cache module のみに閉じ、他 cache に影響しない

### Scenario: cross-context invalidation が 1箇所で broadcast される
  Given dashboard が `chrome.storage.local.set({ settings })` で settings を保存する
  When `chrome.storage.onChanged` が発火する
  Then facade の listener が 1箇所で購読し `SettingsCache.invalidate()` に broadcast され、background の 30s cache が最大 29s stale にならない

### Scenario: redact が StoragePort decorator に移動する
  Given `redactSettingsApiKeys` が `RecordingCache` から削除される
  When settings が session storage に永続化される
  Then `StoragePort` decorator（例: `RedactingStoragePort`）が API キーを空にしてから `store.set` し、cache module は redact を知らない

### Scenario: privacy cache の session fallback が PrivacyCache に閉じる
  Given `PrivacyCache` が `chrome.storage.session` の `privacyCache_<url>` fallback を own する
  When `getPrivacyInfoWithCache(url)` が呼ばれる
  Then in-memory miss 時に session storage を読むロジックが `PrivacyCache` 内にあり、`RecordingCache` facade は委譲のみ

### Scenario: 既存の cache API が facade 経由で互換を保つ
  Given 既存の caller（`headerDetector` / `tabEventHandlers` / `service-worker`）が `recordingCache.getPrivacyCache()` / `getSettingsWithCache()` を呼ぶ
  When facade が 3 cache に委譲する実装に置換される
  Then caller の import / 呼び出しは変更なしで動作し、テストが green

## 受け入れ基準
- [x] `src/background/recordingCache.ts` の 433l 1クラスが 3つの cache module（例: `settingsCache.ts` / `urlCache.ts` / `privacyCache.ts`）に分割され、`RecordingCacheInstance` はそれらを compose する facade になっている
- [x] 各 cache が `TTL` を construction param または module 定数として own し、stale 判定が各 module に閉じている
- [x] `ensureStorageListener()` の `chrome.storage.onChanged` 購読が facade の1箇所に集約され、3 cache への broadcast として実装されている（deregister 可能）
- [x] `redactSettingsApiKeys` が `RecordingCache` から削除され、`StoragePort` decorator（または `SessionStoreRecordingCacheStore` の wrapper）に移動している
- [x] 既存の `RecordingCacheInstance` 公開 API（`getSettingsWithCache` / `getSavedUrlsWithCache` / `getPrivacyInfoWithCache` / `getPrivacyCache` 等）が facade 経由で互換を保ち、既存テストが green
- [x] `npm run validate` green

## テスト戦略
- 単体: 各 cache の TTL / isStale / invalidate を独立して検証（30s / 60s / 5m の境界値テスト）
- 単体: `RedactingStoragePort` decorator が API キーを空にして永続化することを検証（VULN-014 回帰）
- 統合: `chrome.storage.onChanged` の broadcast が 3 cache に届くことを fake `chrome.storage` で検証
- 統合: privacy cache の session fallback（`privacyCache_<url>` の read / expired eviction / restore）を InMemory session mock で検証
- 回帰: 既存の `recordingCache` テストを facade 経由で実行し green

## 見積もり
2 pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `src/background/recordingCache.ts` が facade 化され、各 cache の TTL が独立した module に分離している
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` の RecordingCache 節を 3 cache 前提に更新）
- [x] `npm run validate` green

## 実装メモ（任意）
- ファイル配置は `src/background/cache/settingsCache.ts` 等のサブディレクトリも検討。既存の `src/background/recordingCache.ts` は facade として残し、3 cache は同ディレクトリに新規作成する形でも可。
- `saveQueueScheduled` microtask は facade が own するか、各 cache が個別に持つかは実装時に選択。deregister のために `dispose()` を facade に追加することも検討。
