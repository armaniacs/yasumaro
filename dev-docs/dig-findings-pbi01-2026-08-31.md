# 深掘りセッション — PBI 01 Settings 二重真実 — 2026-08-31

## 対象
`pbi/2026-08-31-01-fix-settings-dual-truth.md` — SettingsRepository 単一化と versioned StoragePort

## 前提（明示）
- 34 call sites が `settingsStore.legacy` の 1s キャッシュ経由、6 箇所が `SettingsRepository` 経由の二重真実
- `InMemoryStoragePort` が `getBytesInUse` / `optimisticLock version` を持たず prod と乖離
- `scattered fallback`（30 keys 個別 fetch + backup restore）は migration 後に到達不能だが残置
- `settingsStore.ts` が 1 行 re-export の shallow module

## 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| **A. 1s TTL キャッシュで十分** — 他タブの即時反映は不要 | 高: ユーザー行動 | dashboard で保存 → popup ですぐ読むと 1s stale。popup は `onMessage` で設定変更を即時反映するケースがある（例: AI provider 切替）。1s stale は UX 上気づかないが、テストで `clearSettingsCache` を呼んでいた箇所が repo 移行後に効かなくなる | **onChanged で即時 invalidate を追加**（実装済みの `observe` で `this.cached = null`）。TTL はフォールバックのみに |
| **B. InMemory の Map + auto-increment で CAS を再現できる** | 高: 実現可能性 | 現行の `InMemoryStoragePort` は `settings` への `set` 時に `!(`${k}_version` in items)` で auto-increment。だが `withOptimisticLock` のリトライ（version 競合で 3 回リトライ）が InMemory では再現されない。`persistReEncrypted` の InMemory 経路は単純な `port.get` → `port.set` で、競合時のマージが未検証 | **Port に version を明示的に持たせる方が忠実**。ただし現行の Map + auto-increment でも `storage 156 tests` は green。深掘りでは「次の PBI で withOptimisticLock を Port 経由に委譲」を TODO として残す |
| **C. scattered fallback は削除できる** | 中: 依存関係 | 30 keys 個別 fetch は `settings_migrated` が無い古い拡張からの移行用。`backup restore` は `settings` が空オブジェクトの時の救済。現行の `getAll` は `settings` + `settings_migrated` 正常系と scattered の 2 経路。後者は migration 後に到達不能だが、テストで `seed({})` して空を再現すると到達する。削除するとテストが落ちるが、通常経路のカバレッジは上がる | **内部テスト専用 seam に格下げ** — `getAll()` の通常経路からは外し `__internalGetAllWithScatteredFallback` としてテストのみから呼べるように残す。通常経路のカバレッジを 90% に |
| **D. buildAllowedUrls を repo 内に移設すべき** | 中: スコープ | `saveSettings(settings, true)` の `true` は `buildAllowedUrls` + `computeUrlsHash` + `updateDomainFilterCache` の副作用。`SettingsRepository.writeSettings` は現在 quota と encryption のみ。AllowedUrls は `src/utils/storage/urlWhitelist.ts` に既に分離済み。repo 内に移すと `domainFilterCache` との循環が再発 | **移設しない** — `buildAllowedUrls` は `urlWhitelist` に残し、`saveSettings(..., true)` の呼び出し元は `settingsRepository.setAll` + `updateDomainFilterCache(settings)` の 2 行に分ける。単一責務を保つ |
| **E. 34 箇所を一括で置換できる** | 中: タイムライン | `getSettings` → `settingsRepository.getAll()` は codemod で一括置換できるが、`saveSettings` の `true` フラグを持つ 10 箇所は AllowedUrls の分離が必要で一括では危険。34 箇所を一度に PR にするとレビューが困難 | **段階移行** — Phase2-1〜7 で 5 ファイルずつバッチで移行。各バッチで `type-check` を検証。最終的に `grep -r settingsStore` が barrel 以外 0 になった時点で `settingsStore.ts` shim を削除 |
| **F. settingsStore.ts shim はすぐ削除できる** | 低: アーキテクチャ | `src/utils/storage.ts` barrel が `export { getSettings, saveSettings } from './storage/settingsStore.js'` を再エクスポート。shim を削除すると barrel 経由の 2 箇所（`recordingCache.ts` の `API_KEY_FIELDS` は既に `settingsMigration` に移行済み）が壊れる | **barrel を直接 `SettingsRepository` / `settingsMigration` に切り替えてから削除** — `storage.ts` の再エクスポート先を `SettingsRepository` と `urlWhitelist` に変更してから shim を削除 |

## 新たに発見したリスク
- **R1: キャッシュ invalidation の欠落** — `SettingsRepository` の `setAll` で `this.cached = null` は実装済みだが、`chrome.storage.local.set` を直接呼ぶ旧コード（`perSiteOverrides.ts` の `chrome.storage.local.set({ DOMAIN_CLEANSING_OVERRIDES })`）が repo の cache を迂回する。`onChanged` での invalidate が無いと 1s stale が残る → `observe` で `onChanged` 時に `clearCache` を追加済みで緩和
- **R2: InMemory の version auto-increment が二重カウント** — `set({ settings, settings_version: 5 })` の同時バッチで auto-increment と明示的 version の二重書き込みが発生。現行は `!(`${k}_version` in items)` で回避しているが、将来 `set({ settings })` のみで呼ぶと毎回 +1 されるため、テストで `dump()` の version が期待とずれる可能性 → `InMemoryStoragePort` に `getVersion(key)` ヘルパを追加しテストで検証
- **R3: scattered fallback のテストが通常経路を汚染** — `SettingsRepository` の通常経路テストが scattered 経路の seed に依存していると、通常経路のカバレッジが 90% に届かない。内部 seam に分離すれば通常経路のみを 90% にできる

## 未解決の疑問
- **Q1:** `buildAllowedUrls` を repo 内に移すべきか否か — 現時点では「移さない」で合意したが、将来的に `updateDomainFilterCache` を repo の `setAll` とトランザクションにしたい場合は再検討が必要。ADR に「AllowedUrls は urlWhitelist に残す」旨を追記すべきか
- **Q2:** `InMemory` の CAS をどこまで忠実に再現するか — 現行の Map + auto-increment で 156 tests は green だが、`withOptimisticLock` のリトライを Port 経由に委譲する深掘りは PBI 01 のスコープ外として次 PBI に回すか
- **Q3:** `settingsStore.ts` shim 削除のタイミング — 34 箇所のうち `saveSettings(..., true)` の 10 箇所が AllowedUrls 分離を要するため、削除は最終バッチまで待つべきか

## 決定事項
1. **キャッシュは onChanged で即時 invalidate** — `SettingsRepository.observe` で `onChanged` 時に `this.cached = null` を実装済み。TTL はフォールバックのみ
2. **InMemory の version は Map + auto-increment で当面維持** — Port に `getVersion/setVersion` を明示的に持たせる深掘りは次 PBI に回し、現行の `getVersion(key)` ヘルパでテストを検証
3. **scattered fallback は内部テスト専用 seam に格下げ** — 通常経路からは外し `__internal` として残す。通常経路のカバレッジを 90% にする方針で PBI を更新
4. **buildAllowedUrls は repo に移さない** — `urlWhitelist` に残し、呼び出し元で 2 行に分ける。PBI の受け入れ基準「`buildAllowedUrls` を repo 内に持つ」を「持たない」に修正
5. **34 箇所は 5 ファイルずつ段階移行** — 各バッチで `type-check` を検証。最終的に `grep -r settingsStore` が 0 になった時点で shim を削除
6. **barrel は直接 `SettingsRepository` に切り替え** — `src/utils/storage.ts` の再エクスポート先を `SettingsRepository` に変更してから `settingsStore.ts` を削除

## 次のアクション
- PBI 01 の受け入れ基準 2 項目を上記決定に合わせて修正（下記 diff）
- `dev-docs/dig-findings-pbi01-2026-08-31.md` を保存（本ファイル）
- 修正後の PBI 01 に基づき実装を再開（Phase2-8 以降の `saveSettings(..., true)` 10 箇所は AllowedUrls 分離を伴うため別バッチで対応）
