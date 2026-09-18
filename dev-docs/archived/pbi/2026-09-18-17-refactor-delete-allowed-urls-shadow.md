# PBI: allowedUrls デッドコピーの削除（refactor）

優先度: 台帳 RICE 16.0（Reach 4 / Impact 2 / Confidence 1.0 / Effort 0.5pt）
backlog: [2026-09-18-00-backlog-archloop-0918.md](2026-09-18-00-backlog-archloop-0918.md)（台帳、候補 C1）
依存: なし

## ユーザーストーリー

許可URL（allow-list）を保守する開発者として、SSOT から乖離した古い分身モジュールを削除してほしい、なぜなら `urlWhitelist` 側がフィルターリスト5オリジンを `FILTER_LIST_SOURCES` SSOT に抽出済みなのに対し、`allowedUrls.ts` 側は同じ5オリジンが未置換 literal で残留しており、SSOT 変更時に古い分身が静かに乖離するから。

## 背景（現状と課題）

`src/utils/allowedUrls.ts`（105行）は `src/utils/storage/urlWhitelist.ts` の古いコピーで、以下の3関数が重複する:

1. `buildAllowedUrls` — urlWhitelist 版は `FILTER_LIST_SOURCES` SSOT を使用（PBI 2026-09-11-05）、allowedUrls 版は 5 literal 残留（`raw.githubusercontent.com` / `gitlab.com` / `easylist.to` / `pgl.yoyo.org` / `nsfw.oisd.nl`）
2. `computeUrlsHash` — 同一実装の複製
3. `getAllowedUrls` — allowedUrls 版は key パラメータ付き、urlWhitelist 版は `StorageKeys.ALLOWED_URLS` 固定

実測の生存経路（全て死）:

- production: `compositionManifest.ts` と `ProviderStrategy.ts` は **urlWhitelist 直参照**。`storageUrls.ts` barrel の5消費者（recordSession・cleansingStatsView・aiSummaryCleansingPanel・sqliteHistoryQuery・sqliteHistoryModel）は `SavedUrlEntry` / `getSavedUrlEntries` / `removeSavedUrl` のみ使用し、許可URL4関数は未使用。`storage.ts` barrel（deprecated・production importer 0）は urlWhitelist から再exportしており allowedUrls.ts には触れない
- テスト: `storage-buildAllowedUrls.test.ts` と `storage.test.ts` は **urlWhitelist 版**を対象とする。allowedUrls.ts 専用テストは存在しない

deletion test: 削除しても複雑さは再出現しない（pass-through + stale copy）→ keep に値しない。

## BDD受け入れシナリオ

```gherkin
Scenario: 削除後も許可URLの生成は従来どおりである
  Given allowedUrls.ts を削除した状態
  When compositionManifest が buildAllowedUrls を呼ぶ
  Then FILTER_LIST_SOURCES 由源のオリジン群を含む許可URL集合が返る（urlWhitelist 経由・挙動不変）

Scenario: フィルターリスト SSOT の単一性が保たれる
  Given allowedUrls.ts の5 literal が削除された状態
  When grep で filter-list オリジン literal を検索する
  then 許可URL構築の literal は listSources.ts（FILTER_LIST_SOURCES）にのみ存在する
```

## 受け入れ基準

- [x] `src/utils/allowedUrls.ts` が削除されている
- [x] `storageUrls.ts` から `buildAllowedUrls` / `computeUrlsHash` / `saveSettingsWithAllowedUrls` / `getAllowedUrls` の4再exportが除去されている
- [x] `from '.*allowedUrls\.js'` の import が src 全体で 0 件（urlWhitelist 自身のファイル名命中を除く）
- [x] `npm run type-check` が green
- [x] storage 系・fetch 系の既存 vitest が green（urlWhitelist 版のテストは無修正でパス）
- [x] `npm run build` が green

## テスト戦略

- 既存テスト（urlWhitelist 版対象）が無修正でパスすること = 挙動不変の証明
- grep による残留参照の機械確認

## 見積もり

0.5pt（1ファイル削除 + barrel 再export除去）。

## 実装ガイド

- 着手時点での確認ポイント: `grep -rn "allowedUrls\.js"` で参照ゼロを再確認（本 PBI 作成時に production 0 を実測済みだが行番号はズレる）
- `storageUrls.ts` の SavedUrlEntry 系再exportには触れないこと
- git mv による pbi アーカイブは統合側が行う
