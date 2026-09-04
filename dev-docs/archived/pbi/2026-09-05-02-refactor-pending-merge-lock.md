# PBI 02: pending 書き込みの merge 政策をロック内フックに集約

優先度: 2 位 / RICE 16.0 = (6 × 2 × 80%) / 0.6w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch4.md](2026-09-05-00-backlog-arch4.md)
依存: なし（他 6 件と独立。PBI 07 とは対象が異なる — 本 PBI は background のロック付きキュー、PBI 07 は utils の回復ストア）

## ユーザーストーリー
再試行キューを保守する開発者として、URL 結合・切り詰め・サイズ上限の政策がキューのロック内で実行されてほしい。なぜなら現状は `enqueuePendingWrite` が `load()`→`save()` をロック外で直に行い、flush 中の並行 enqueue で書き込み消失が起きうる構造であり、merge 時の retry-count リセットが backoff を捨て、2 つのサイズ上限が乖離しているから。

## BDD受け入れシナリオ

```gherkin
Scenario: flush 中の enqueue が消失しない
  Given flush 実行中に同一 URL の enqueue が割り込む
  When  両方が完了する
  Then  結合結果が1件として残り、欠落がない

Scenario: merge が backoff を継承する
  Given retryCount>0 の既存エントリに同一 URL が来る
  When  結合される
  Then  retryCount がリセットされず継続し、timestamp は新しい方になる

Scenario: サイズ上限が単一テーブルになる
  Given 上限超過の patch
  When  enqueue される
  Then  content-first→tag-trim の順序で1箇所の上限に収まる
```

## 受け入れ基準
- [x] `pendingChromeStorageQueue.ts:123-149` の merge がキューロック内フックで実行される（`PersistentRetryQueue` の直列化を経由）
- [x] `truncatePatchToFit`（:68-105）と `maxPayloadBytes` / `MAX_PATCH_PAYLOAD_BYTES` の二重上限が単一政策になる
- [x] merge 時の `retryCount: 0` リセットが backoff 継承になる（既存 backoff 検証と矛盾しないこと）
- [x] `queue/payload.ts` の `estimatePayloadSize` は共有計測器として残し、政策判断は呼び出さない
- [x] 既存 queue suite が green。新規 interleaving テスト（in-memory adapter）が追加される

## テスト戦略（t_wadaスタイル）
### 単体テスト
- merge 政策フックの matrix（同一 URL 結合・tag-union・timestamp-max・backoff 継承・truncate 順序）
- in-memory adapter での enqueue/flush 交互実行テスト
### 統合テスト
- 既存 queue テストは無修正で green
### 例外ハンドリング
- 上限超過・破損エントリ・store 例外の経路

## 実装アプローチ
- **Outside-In**: merge-policy フックの型（in-lock 実行保証）から設計 → chrome-storage queue をフック利用に → truncate/上限を政策モジュールに → interleaving テスト追加

## 見積もり
0.6w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: in-memory adapter＋policy hook でロック内実行を決定的に検証
- 非機能要件: flush の allSettled 並行性・health-check piggyback（PBI 05）は不変。AlarmRegistry の offline-retry 経路は無修正

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '60,185p' src/background/pendingChromeStorageQueue.ts
sed -n '60,190p' src/background/persistentRetryQueue.ts
```
2026-09-05 時点: merge（:123-149）が `queue.load()` 直呼び。flush（:167-182）はロック経由。truncate（:68-105）は content-first→tag-trim（50 件）。`filterExpiredAndOverRetry`（persistentRetryQueue:299-315）は単一政策の前例。

### 実装手順
1. `PersistentRetryQueue` に merge-policy フック口（in-lock 実行）を追加
2. URL-merge＋truncate＋timestamp-max を pending-patch 政策モジュールに抽出
3. chrome-storage queue をフック利用に書き換え（facade は adapter 化）
4. interleaving テスト追加 → 全 green

### 落とし穴
- `flushPendingWrites` のシグネチャ変更は AlarmRegistry 経路に波及する — 変更する場合は alarm テストも更新すること
- `retryCount` 継承は既存 backoff テストと突き合わせること（リセット前提のテストがあれば更新）
- `pendingSqliteQueue`（98 行）と `offlineNetworkQueue`（QueuePort 付き）は対照事例。揃える必要はないが、矛盾する政策を増やさないこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] queue 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（queue のロック政策があれば DESIGN_SPECIFICATIONS に追記）
