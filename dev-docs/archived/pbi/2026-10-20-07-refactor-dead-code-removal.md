# PBI 07: 未使用エクスポート・死にコードの削除（19 件）

## ユーザーストーリー
メンテナーとして、本番から到達できないエクスポート・契約が削除された状態がほしい、なぜなら死にコードは保守対象として残り、意図が伝わらず誤読とメンテコストを生むから。

## 変更点の概要
本番呼び出し 0 件のエクスポート・クラス・契約を削除する（テストごと）。削除は本番経路に触れないため挙動は不変。削除が妥当かの最終判断は実装時に再度 grep で確認する。

## 現状と問題（production 呼び出し 0 件の裏取り済み）
- src/utils/trustDb/trancoChangeDetector.ts:71（クラス全体 271 行）※ PBI 09 で個別扱い
- src/utils/cspValidator.ts:244（enqueueQueuedRequest）、:443（safeFetch）※ PBI 08 で個別扱い
- src/utils/markdownSanitizer.ts:26（sanitizeMarkdownLinks、後継は sanitizeAllMarkdownLinks / sanitizeForObsidian）
- src/utils/errorClassification.ts:277（convertKnownErrorMessage、テストが不具合側を golden 固定）
- src/messaging/types.ts:78-110（isMaskedItem）
- src/utils/masterPassword.ts:93-98（isMasterPasswordSet、raw リテラル 'master_password_enabled'）
- src/utils/storage/domainFilterCache.ts:29-47（getDomainFilterCacheSync、callback API）
- src/utils/urlWhitelist.ts:139-143（getAllowedUrls）
- src/background/cache/SettingsCache.ts / UrlCache.ts の get()（facade 再実装、production 0）
- src/utils/domainUtils.ts:150-165（validateDomainList）
- src/utils/promptSanitizer.ts の _normalizedContent / formatWarnings（未使用）
- src/utils/domainUtils.ts の DomainFilter.parse（未使用）
- src/dashboard/cleansingStatsView.ts:209-248（makeCleansingProgressBar）
- src/content/watchDynamicContent.ts（本番 import 皆無、参照はテストのみ）
- src/utils/tagUtils.ts:30（getDefaultCategories、Date.now() 直読みの非決定的実装、テストだけが存在を支える）
- src/utils/optionBuilder.ts.bak（83 行）
- src/messaging/sqliteMessages.ts:29（SQLITE_EXPORT 到達不能契約: retry policy 行 transportRetryPolicy.ts:63 / handler sqliteMessageHandlers.ts:357 / test fake inMemoryTransport.ts:161 の 4 箇所で保守されるが sender なし）
- src/dashboard/panels/asyncData/tagClusterPanel.ts:171-175（init?.focusTag の no-op 死に分岐）
- scripts/check-version-consistency.js:30-33（extractVersion の manifest.json 分岐、VERSION_FILES 未収載で到達不能）

## 変更の理由
[可読性/保守性] いずれも production 呼び出し 0 件を Grep で裏取り済み。削除はバグ温床の誤読を防ぐ。SQLITE_EXPORT は到達不能契約の 4 箇所保守コストを止める。

## BDD受け入れシナリオ
Scenario: 削除後も本番経路は不変
  Given 削除対象のエクスポートは production 呼び出し 0 件
  When 削除を実施する
  Then 本番経路の挙動は変更されず、全テストが通過する

Scenario: 誤用の再発防止
  Given 削除対象の名前で検索する
  When リポジトリ全体を grep する
  Then 該当は 0 件になる（.bak を含む）

## 見積もり
2 pt（RICE: 38 = Reach 19 × Impact 2 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [x] 各削除の直前に再 grep で production 呼び出し 0 件を確認
- [x] 削除後の npm run validate 通過
- [x] npm run build 通過

## 実装記録（2026-10-21）
- 死にコード 19 件を削除（-1100 行）: sanitizeMarkdownLinks、convertKnownErrorMessage（不具合側 golden 固定テスト込み）、isMaskedItem、isMasterPasswordSet、getDomainFilterCacheSync、getAllowedUrls、SettingsCache.get / UrlCache.get、validateDomainList、DomainFilter.parse、promptSanitizer の _normalizedContent+normalizeUnicode / formatWarnings、makeCleansingProgressBar、watchDynamicContent.ts（ファイル削除）、getDefaultCategories、optionBuilder.ts.bak（ファイル削除）、SQLITE_EXPORT 到達不能契約 5 箇所（union・配列・retry 行・handler・fake）、tagClusterPanel init?.focusTag 死に分岐、check-version-consistency.js の manifest.json 到達不能分岐
- 削除に伴う pin テスト更新（types 長 34→33・handler Map 34→33・retry policy 期待値ほか）
- 付随所見: handleExport 削除により recordsRepo.serialize が本番到達不能（後続 PBI 候補として記録のみ）
- 検証: 担当モジュールのテスト全 green（4 バッチ計 2802 tests）、check-deprecated-aliases OK、type-check 通過、build 通過、validate:fast green
