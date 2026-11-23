# utils baseline (Phase A スライス A3, 2026-11-12)

対象 PBI: `pbi/2026-09-25-30-refactor-utils-namespace-reorg.md`
作業: baseline survey のみ。移動・改名・import 変更なし。ソース無改変。
計測日 (JST): 2026-11-12。計測は機械的計数 + 目視分類のみ。

## 1. 実測値 vs PBI 記載値

| 指標 | PBI 記載値 | 実測値 (2026-11-12) | 差分 |
| --- | --- | --- | --- |
| `src/utils/` 直下 production TS ファイル数 | 96 | 118 | +22 |
| production サブディレクトリ数 (直下, `__tests__` 除く) | 10 | 11 | +1 |
| `__tests__` (直下) | 1 | 1 | 0 |
| utils 配下 production TS 合計 (`__tests__` 除外) | 196 | 236 | +40 |
| `src/utils/` 直下 entries 総数 (ファイル + ディレクトリ) | 107 (実装者向け注記) | 130 | +23 |

計数方法:

- 直下ファイル数: `ls -1 src/utils/*.ts` の行数 = 118。直下 entries (`ls -1 src/utils/`) = 130 行で、内訳は TS ファイル 118 + ディレクトリ 12。
- 直下ディレクトリ 12 の内訳: `__tests__`, `aiSummaryCleaner`, `contentExtractor`, `crypto`, `domainFilter`, `logger`, `sessionReminder`, `storage`, `text`, `trustDb`, `ublockParser`, `ui`。 production は `__tests__` を除く 11。
- サブディレクトリ別 production TS (`__tests__` 除外の再帰計数): `aiSummaryCleaner` 15, `contentExtractor` 11, `crypto` 12, `domainFilter` 1, `logger` 9, `sessionReminder` 2, `storage` 35, `text` 2, `trustDb` 19, `ublockParser` 7, `ui` 5。合計 118。
- 合計: 直下 118 + サブディレクトリ配下 118 = 236 (`find src/utils -name '*.ts' -not -path '*__tests__*'` の行数と一致)。
- `src/utils/__tests__/` 直下のテスト TS は 211 ファイル。なお utils 配下の `__tests__` ディレクトリは直下 1 個に加え、サブディレクトリ内に 10 個 (`ui`, `aiSummaryCleaner`, `contentExtractor`, `crypto`, `logger`, `sessionReminder`, `ublockParser`, `storage`, `text`, `trustDb` の各配下) あり、合計 11 個。PBI の「`__tests__` 1 個」は直下のみを指すと解釈すれば差分 0。

## 2. 直下ファイル責務グループ仮案 (118 行)

機械的ファイル名分類 + 各ファイル先頭コメント・export の目視確認による仮案。グループ名は英小文字 1 語。確定ではなく Phase A 後続の対応付け作業の出発点とする。

| ファイル名 | 推定グループ |
| --- | --- |
| Mutex.ts | concurrency |
| RateLimitService.ts | auth |
| aiLimits.ts | ai |
| aiUsageTracker.ts | ai |
| archiveGuards.ts | archive |
| auditLog.ts | audit |
| backoff.ts | retry |
| browserSupport.ts | browser |
| captureOutcome.ts | recording |
| cleansingBadge.ts | cleansing |
| cleansingConfig.ts | cleansing |
| clipboard.ts | clipboard |
| collectionQueryV2.ts | collection |
| commonTypes.ts | types |
| compareStrings.ts | strings |
| computeLimits.ts | limits |
| contentCleaner.ts | content |
| contentDedupHybrid.ts | content |
| contentDeduplicator.ts | content |
| copyMarkdownButton.ts | markdown |
| cspDomains.ts | csp |
| cspValidator.ts | csp |
| cssUtils.ts | css |
| customPromptUtils.ts | prompt |
| dailyNotePathBuilder.ts | obsidian |
| degradedSummary.ts | summary |
| derivedUblockRules.ts | ublock |
| deviceUtils.ts | device |
| domClear.ts | dom |
| domainUtils.ts | domain |
| domainValidator.ts | domain |
| e2eTestState.ts | test |
| elementClassName.ts | dom |
| errorClassification.ts | error |
| errorUtils.ts | error |
| extensionOrigin.ts | extension |
| failureTaxonomy.ts | error |
| fetch.ts | network |
| generateId.ts | id |
| htmlEscape.ts | html |
| htmlFragment.ts | html |
| httpFailureMessages.ts | http |
| i18n-dom.ts | i18n |
| i18n.ts | i18n |
| i18nPlural.ts | i18n |
| importPipeline.ts | import |
| limits.ts | limits |
| listSources.ts | filterlist |
| llmOutputGuard.ts | llm |
| localDate.ts | date |
| localeUtils.ts | i18n |
| logTruncate.ts | logging |
| loopbackPorts.ts | network |
| luhn.ts | pii |
| markdownFormatter.ts | markdown |
| markdownSanitizer.ts | markdown |
| markdownTemplateUtils.ts | markdown |
| masterPassword.ts | auth |
| masterPasswordUiCore.ts | auth |
| modelsDevApi.ts | ai |
| navUrl.ts | url |
| objectUtils.ts | objects |
| obsidianConfigBuilder.ts | obsidian |
| obsidianConfigValidator.ts | obsidian |
| pageContentPipeline.ts | content |
| pathSanitizer.ts | path |
| pendingRowActions.ts | pending |
| pendingRowRenderer.ts | pending |
| pendingStorage.ts | pending |
| permissionManager.ts | permission |
| piiSanitizer.ts | pii |
| ports.ts | testing |
| privacyChecker.ts | privacy |
| privacyStatusCodes.ts | privacy |
| promptSafety.ts | prompt |
| promptSanitizer.ts | prompt |
| rateLimiter.ts | auth |
| readBodyCapped.ts | network |
| reasonLabel.ts | privacy |
| recordingGateTable.ts | recording |
| recoveryClaimStore.ts | recovery |
| registrableDomain.ts | domain |
| retryPredicate.ts | retry |
| scopeHash.ts | security |
| searchQuery.ts | nav |
| selectionText.ts | content |
| sensitiveDataMask.ts | masking |
| sentenceExtractor.ts | nlp |
| sentenceExtractorHybrid.ts | nlp |
| settingsExportImport.ts | settings |
| settingsExportImportUiCore.ts | settings |
| settingsFormBinding.ts | settings |
| settingsSchemas.ts | settings |
| singleFlight.ts | concurrency |
| skipReason.ts | recording |
| sqlite-types.ts | storage |
| ssrfGuard.ts | security |
| storageUrls.ts | storage |
| string.ts | strings |
| summaryFallback.ts | summary |
| summaryNormalizer.ts | summary |
| svgNamespace.ts | dom |
| tagCooccurrence.ts | tags |
| tagCooccurrenceHybrid.ts | tags |
| tagLike.ts | tags |
| tagUtils.ts | tags |
| trustChecker.ts | trust |
| typeUtils.ts | types |
| types.ts | types |
| ublockMatcher.ts | ublock |
| urlEntry.ts | url |
| urlHash.ts | url |
| urlUtils.ts | url |
| vfsCapabilities.ts | vfs |
| visitThresholds.ts | recording |
| wasmHybridRuntime.ts | wasm |
| wildcardToRegex.ts | domain |
| yamlFrontmatter.ts | markdown |

分類表の行数: 見出し・区切り行を除くデータ行 118 行 (直下 TS 118 ファイルと一致)。

## 3. 懸念点

- baseline のずれが大きい。直下 +22、合計 +40 は誤差ではなく、PBI 作成後にファイル追加・サブディレクトリ追加 (`ui`, `text` 等の新設可能性) が進んだことを示す。Phase A 後続で PBI 記載値を改定するか、差分の内訳 (新規追加ファイル一覧) を別途記録する必要がある。
- production サブディレクトリが 10 → 11 に増えている。どのディレクトリが追加分かを特定していない (候補は `ui` / `text` / `trustDb` 等)。再編先の責務整合を決める前に追加分の来歴確認が必要。
- `auditLog.ts`、`storageUrls.ts` は re-export shim の可能性が高く、移動時に循環・二重 export の発生源になる。グループ仮案では audit / storage に置いたが、実移動では shim 解消の扱いを別途決める必要がある。
- `ports.ts` (Clock / StoragePort / AlarmPort の注入 seam) を testing に仮置きしたが、実態は network・storage 横断の基盤であり、配置先の選定で議論が必要。
- グループ名は 1 語の仮案であり、`content` / `summary` / `nlp` / `markdown` の境界、`privacy` / `security` / `pii` / `masking` の境界は目視のみで未検証。後続の対応付け作業で import baseline と突き合わせること。
- 本ファイルは新規作成のみ。既存ファイルは一切変更していない。git 操作・pbi/INDEX 編集は行っていない。
