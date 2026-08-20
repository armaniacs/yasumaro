# src/utils/ Layer Architecture

`src/utils/` 配下の層構造を形式化し、新規ファイル配置時の判断と循環依存の保護を目的とする。

## Layer 定義

| Layer | 名称 | 依存可 | 説明 |
|-------|------|--------|------|
| **0** | Foundation | なし (pure) | 外部 `src/utils/` に依存しない純粋関数・型・定数。chrome API への依存も持たない |
| **1** | Infrastructure | Layer 0 のみ | `chrome.storage` や永続化を伴う infrastructure。Layer 0 のみ import 可 |
| **1-循環** | Infrastructure (循環あり・例外) | Layer 0 + 相互 | 業務ルール上相互参照が不可避で `await import()` で循環を回避している例外。ADR に記録 |
| **2** | High-level Utilities | Layer 0/1 | アプリケーションロジック。content 抽出・AIクレンジング等の高レベル処理 |
| **Barrel** | Re-export | Layer 0/1/2 を再エクスポート | 後方互換のための再エクスポート層。新規コードは直接 import を推奨 |

## ファイル分類

### Layer 0 — Foundation (依存なし)

```
src/utils/errorUtils.ts
src/utils/objectUtils.ts
src/utils/string.ts
src/utils/htmlEscape.ts
src/utils/urlUtils.ts
src/utils/wildcardToRegex.ts
src/utils/pathSanitizer.ts
src/utils/cssUtils.ts
src/utils/crypto/primitives.ts
src/utils/crypto/envelope.ts
src/utils/crypto/hmacKeyStore.ts
src/utils/logger/types.ts
src/utils/logger/buffer.ts
src/utils/logger/sanitize.ts
src/utils/commonTypes.ts
src/utils/buffer.ts
src/utils/i18nPlural.ts
```

`logger/` の一部は `piiSanitizer` に依存するが、これは Layer 0 内の相互依存として許容する。

### Layer 1 — Infrastructure (Layer 0 のみ依存)

```
src/utils/storage/types.ts
src/utils/storage/defaults.ts
src/utils/storage/encryptionSession.ts
src/utils/storage/settingsStore.ts  — ただし trustDb との循環あり (Layer 1-循環として例外扱い)
src/utils/storage/savedUrlRepository.ts
src/utils/storage/domainFilterCache.ts
src/utils/storage/quota.ts
src/utils/storage/storageMaintenance.ts — 例外: background/sqliteClient.ts への逆方向依存あり
src/utils/optimisticLock.ts
src/utils/Mutex.ts
src/utils/rateLimiter.ts
src/utils/domainUtils.ts
src/utils/trustDb/domainValidation.ts
src/utils/trustDb/managedStringList.ts
```

### Layer 1-循環 — Infrastructure (循環あり・例外)

```
src/utils/storage/settingsStore.ts  ↔  src/utils/trustDb/trustDb.ts
  - settingsStore.ts: getSettings() 初回実行時に TrustDb 初期化を dynamic import でトリガー (L72)
  - trustDb.ts: Tranco version の保存/読取で getSettings/saveSettings を dynamic import で利用 (L62-66)
  - 回避手法: 双方とも await import() による遅延 import。ESM モジュールキャッシュで2回目以降即時解決
  - 詳細は ADR 2026-08-20-utils-layer-circular-dependency を参照

src/utils/trustDb/trancoConsentManager.ts → src/utils/storage.ts (barrel) + settingsStore (dynamic)
src/utils/storage/storageMaintenance.ts → src/background/sqliteClient.ts (utils → background 逆方向依存)
```

これらは削除不可。将来のリファクタで「なぜこんな複雑な import？」と除去しないこと。

### Layer 2 — High-level Utilities (Layer 0/1 依存)

```
src/utils/pageContentPipeline.ts
src/utils/aiSummaryCleaner/
src/utils/sentenceExtractor.ts
src/utils/promptSanitizer.ts
src/utils/piiSanitizer.ts
src/utils/markdownFormatter.ts
src/utils/obsidianConfigValidator.ts
src/utils/fetch.ts  — ssrfGuard.ts への委譲あり
src/utils/ssrfGuard.ts
src/utils/cspValidator.ts
src/utils/trustDb/  — 上記循環を除き Layer 0/1 のみに依存するモジュール群
src/utils/ublockParser/
src/utils/ublockMatcher/
```

### Barrel — Re-export (後方互換)

```
src/utils/storage.ts      — 88行38export、36箇所から参照。@deprecated。4つの深いモジュールへ分割済みの再エクスポート層
src/utils/logger.ts       — 42行、logger/* からの再エクスポート。約120箇所から参照
src/utils/crypto/index.ts — crypto/* からの再エクスポート
```

新規コードは barrel 経由ではなく各モジュールから直接 import すること。

## 依存ルール

```
Layer 0 → 依存不可 (pure)
Layer 1 → Layer 0 のみ import 可
Layer 1-循環 → Layer 0 + 相互の dynamic import のみ許容
Layer 2 → Layer 0/1 import 可
Barrel → Layer 0/1/2 を再エクスポートのみ
逆方向依存 (utils → background) は禁止。ただし storageMaintenance.ts → sqliteClient.ts は例外として記録
```

違反検出:

```bash
# Layer コメントが付与されているか確認
grep -rn "@layer" src/utils/ | wc -l

# Layer 0 が storage に依存していないか検証 (違反があれば出力される)
grep -rn "from.*storage" src/utils/errorUtils.ts src/utils/objectUtils.ts src/utils/crypto/primitives.ts

# 循環 import が dynamic import であることを検証
grep -n "await import" src/utils/storage/settingsStore.ts src/utils/trustDb/trustDb.ts
```

## 新規ファイル配置チェックリスト

新規 utility を追加する際は以下で層を判定する:

- [ ] Layer 0 (logger, crypto, errorUtils) のみに依存するか？ → Layer 1 or 2
- [ ] `chrome.storage` や永続化を伴うか？ → Layer 1
- [ ] `storage` / `trustDb` / `repositories` を import するか？ → Layer 2
- [ ] どれにも当てはまらない純粋関数か？ → Layer 0
- [ ] ファイル先頭に `// @layer N — <purpose>` コメントを付与したか？
- [ ] 循環が必要な場合は ADR に記録したか？

例:

```typescript
// @layer 1 — Infrastructure: domain filter cache
export function getDomainFilterCacheSync() { ... }
```

## 将来の移行計画

* **Wave 3**: `storage.ts` barrel の段階的分割 — 各 PBI で barrel の `@deprecated` import を直接モジュール import に置換する小 PBI として切り出す
* **Wave 4**: `logger.ts` barrel の同様の分割
* 循環の解消は業務ルール上不可のため、dynamic import による回避を維持し、ADR で保護する

## 参考

* ADR 2026-08-20-utils-layer-circular-dependency — 循環依存の詳細と保護理由
* ADR 2026-07-26-domain-filter-layer-map — ドメインフィルタ専用の4層モデル
* src/utils/storage.ts ファイルヘッダ — barrel 分割の履歴

