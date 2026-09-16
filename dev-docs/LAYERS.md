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
src/utils/crypto/types.ts
src/utils/crypto/cryptoParams.ts
src/utils/logger/types.ts
src/utils/logger/buffer.ts
src/utils/commonTypes.ts
src/utils/types.ts
src/utils/urlEntry.ts
src/utils/luhn.ts
src/utils/backoff.ts — 指数バックオフ遅延計算の SSOT（PBI 2026-09-17-09）
src/utils/httpFailureMessages.ts — HTTP status→ユーザー文言テーブルの SSOT（PBI 2026-09-17-09）
```

`logger/` の一部は `piiSanitizer` に依存するが、これは Layer 0 内の相互依存として許容する。
ただし `logger/sanitize.ts` は Layer 2 の `piiSanitizer` を静的に import するため Layer 2 に分類する
（PBI 2026-09-17-05 で機械検査の対象外から除外し、Layer 0 リストから移動）。
`crypto/hmacKeyStore.ts` は `chrome.storage` への副作用を持つため Layer 1 に分類する
（旧分類 Layer 0 は誤り。PBI 2026-09-17-05 で訂正）。

### Layer 1 — Infrastructure (Layer 0 のみ依存)

```
src/utils/storage/types.ts
src/utils/storage/defaults.ts
src/utils/storage/encryptionSession.ts
src/utils/storage/SettingsRepository.ts — 旧 settingsStore.ts の後継。trustDb 系との循環は dynamic import で回避（Layer 1-循環の後継関係）
src/utils/storage/savedUrlRepository.ts
src/utils/storage/domainFilterCache.ts
src/utils/storage/privacyConsent.ts — 同意状態ロジック。background/popup/dashboard から直接 import する中立配置
src/utils/storage/quota.ts
src/utils/storage/storageMaintenance.ts
src/utils/storage/storageTransaction.ts — withOptimisticLock 等（旧 optimisticLock.ts の後継）
src/utils/Mutex.ts
src/utils/rateLimiter.ts
src/utils/trustDb/domainValidation.ts
src/utils/trustDb/managedStringList.ts
src/utils/crypto/hmacKeyStore.ts — chrome.storage への副作用を持つため Layer 0 から移動（PBI 2026-09-17-05）
src/utils/masterPassword.ts — chrome.storage への副作用を持つ Infrastructure として Layer 1 に分類（PBI 2026-09-17-05）
src/utils/i18nPlural.ts — chrome.i18n を参照するため Layer 0 から移動（PBI 2026-09-17-05）
```

旧 `settingsStore.ts`・旧 `optimisticLock.ts` は削除済み（後継は上記の通り）。旧分類表に残っていた
`src/utils/buffer.ts` は存在しないファイルのため削除（`logger/buffer.ts` は Layer 0 として存続）。

### Layer 1-循環 — Infrastructure (循環あり・例外)

旧 `settingsStore.ts` ↔ 旧 `trustDb.ts` は分割済み。現行の後継関係（PBI 2026-09-17-05 で確認）:

```
src/utils/trustDb/TrustDbKernel.ts → src/utils/storage/SettingsRepository.ts (dynamic のみ)
  - TrustDbKernel: settingsReader の getAll/setAll が await import() で遅延参照
  - 回避手法: await import() による遅延 import。ESM モジュールキャッシュで2回目以降即時解決
  - 詳細は ADR 2026-08-20-utils-layer-circular-dependency を参照（旧ファイル名時代の記録）

src/utils/trustDb/trancoConsentManager.ts → src/utils/storage.ts (barrel) + settingsStore 系 (dynamic)
  - getSettings/saveSettings を await import('../storage.js') で実行時に取得

src/utils/storage/storageMaintenance.ts → src/background/sqlite/offscreenGateway.js (dynamic)
  - SqliteClient を await import() で遅延参照し、utils → background の静的逆辺を回避
```

これらは削除不可。将来のリファクタで「なぜこんな複雑な import？」と除去しないこと。
循環例外ファイル群は現状ルールの検査対象外（未分類）のため、dynamic → static 化の検出は
レビュー＋下記「機械検査」節の grep 例で行う。分類済みファイルへの新規の上位層 static import
は `local/utils-layer-boundary` が検出する。

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
src/utils/domainUtils.ts — Layer 2 の ublockMatcher を静的に import するため Layer 2 に分類（PBI 2026-09-17-05）
src/utils/logger/sanitize.ts — Layer 2 の piiSanitizer を静的に import するため Layer 2 に分類（PBI 2026-09-17-05）
```

### Barrel — Re-export (retired)

```
src/utils/storage.ts      — @deprecated re-export shim。production は全て直接 import に移行済み（PBI 2026-08-21-04）。テストのレガシー mock 経路のみが参照。eslint no-restricted-imports により新規利用は禁止
src/utils/logger.ts       — 42行、logger/* からの再エクスポート。約120箇所から参照
src/utils/crypto/index.ts — crypto/* からの再エクスポート
```

新規コードは barrel 経由ではなく各モジュールから直接 import すること。`storage.ts` への import は lint が警告する。

## 依存ルール

```
Layer 0 → 依存不可 (pure)
Layer 1 → Layer 0 のみ import 可
Layer 1-循環 → Layer 0 + 相互の dynamic import のみ許容
Layer 2 → Layer 0/1 import 可
Barrel → Layer 0/1/2 を再エクスポートのみ
逆方向依存 (utils → background) は禁止（PBI 2026-09-05-01 で cspValidator/urlWhitelist の providerCatalog 逆辺を解消し、`src/utils/storage/providerAllowlist.ts` の中立テーブルに反転済み）。
対称形の逆転（background → popup 等の UI 層への上向き依存）も禁止。同意状態ロジックは `src/popup/privacyConsent.ts` から `src/utils/storage/privacyConsent.ts` に移動し、background 4箇所・popup 2箇所・dashboard 1箇所が中立層を直接 import する形に解消済み（2026-08-20-utils-layer-circular-dependency の循環とは別件）。
```

違反検出:

```bash
# Layer コメントが付与されているか確認
grep -rn "@layer" src/utils/ | wc -l

# Layer 0 が storage に依存していないか検証 (違反があれば出力される)
grep -rn "from.*storage" src/utils/errorUtils.ts src/utils/objectUtils.ts src/utils/crypto/primitives.ts

# 循環 import が dynamic import であることを検証
grep -n "await import" src/utils/storage/SettingsRepository.ts src/utils/trustDb/TrustDbKernel.ts

# background から UI 層 (popup/dashboard) への上向き import がないことを検証 (出力がなければ正常)
grep -rn "from.*popup/" src/background/
grep -rn "from.*dashboard/" src/background/
```

## 機械検査（PBI 2026-09-17-05）

層境界の一部は `local/utils-layer-boundary`（`eslint/rules/utils-layer-boundary.mjs`、
`eslint.config.js` で error 配線）により lint で強制される。層ファイルリストの SSOT は
ルール内の `LAYER0_FILES`／`LAYER1_FILES`／`LAYER2_MODULES` であり、本ドキュメントの分類表と
対応する。両者に差異を見つけたら分類表・ルールのどちらが正しいかを判断し、揃えること。

検査範囲（v1 — 最大の利益・最小のリスト）:

- Layer 0: `chrome` グローバル参照の禁止（AST の MemberExpression 検出のため、
  コメント・文字列リテラル内の `chrome.*` 言及は誤検出しない。ローカル変数の
  shadowing は scope 解決で除外）。Layer 1／Layer 2／Barrel への静的 import 禁止。
- Layer 1: Layer 2 への静的 import 禁止。
- 検査対象は静的 `ImportDeclaration` のみ。dynamic `import()` は循環回避の正規手法として
  一律対象外（ADR 記録済み例外は構成上 lint を通過する）。`import type` は消去されるため対象外。
- Barrel 経由の新規 import 抑制は既存 `no-restricted-imports`（warn）を維持する。
  本ルールの Layer 1 検査は Barrel 宛を対象外とし二重報告を避ける（Layer 0 の純粋性としての
  Barrel 禁止のみ本ルールが担う）。warn → error への引き上げは barrel 移行の進捗を見て別途判断する。

既知の暫定許可（`eslint.config.js` の `allow`、ADR 未記録）:

- `storage/defaults.ts` → `aiSummaryCleaner/rules.js`: DEFAULT_SETTINGS が SSOT ルール表の
  閾値を束ねるための静的 import。表の複製は drift を再発させるため現状維持。
  後続対応として ADR 化が必要（純粋定数の抽出か分類見直しのいずれか）。

未分類・後続対応（本ルールの検査対象外。手を付ける際は分類→リスト追加の順で行う）:

- `domainFilter/DomainFilter.ts`（`// @layer 1` 自己宣言だが `domainUtils` 経由で Layer 2 に到達）
- `storage/SettingsRepository.ts`・`storage/storageTransaction.ts`・`RateLimitService.ts` 等の
  Wave 以降の新規モジュール群
- Layer 1 の厳密化（「Layer 0 以外への静的 import 禁止」）は上記分類の完了後に検討する

```bash
# 循環 import が dynamic import のままであることを検証（出力の static 化に注意）
grep -n "await import" src/utils/trustDb/TrustDbKernel.ts src/utils/storage/SettingsRepository.ts src/utils/trustDb/trancoConsentManager.ts src/utils/storage/storageMaintenance.ts

# 未分類モジュールの洗い出し（ルール対象外の src/utils ファイル）
comm -23 <(find src/utils -name '*.ts' -not -path '*__tests__*' | sort) <(grep -o "src/utils/[^']*\.ts" eslint/rules/utils-layer-boundary.mjs | sort -u)
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

* **Wave 3**: `storage.ts` barrel — 完了（PBI 2026-08-21-04 + PBI-28）。production・テストとも直接 import 化済み（テスト参照ゼロ）。barrel 本体は `trancoConsentManager.ts` の dynamic import（循環回避の意図的設計）が残るため維持し、`storage.ts` ヘッダに残置理由を記録
* **Wave 4**: `logger.ts` barrel の同様の分割 — 配線完了（PBI 2026-09-05-03）。`core.ts` が `LoggerWiring`（`initLogger` 注入・lazy chrome デフォルト・`resetLoggerWiring`）を受け、offscreen console フォールバックは `ChromeStorageLogAdapter` に移動。eslint は barrel 側を warn（`logger/*` 直接 import を推奨）に反転済み。残作業: 約120箇所の呼び出し側の直接 import 移行（別 PBI 化を推奨）
* 循環の解消は業務ルール上不可のため、dynamic import による回避を維持し、ADR で保護する

## 参考

* ADR 2026-08-20-utils-layer-circular-dependency — 循環依存の詳細と保護理由
* ADR 2026-07-26-domain-filter-layer-map — ドメインフィルタ専用の4層モデル
* src/utils/storage.ts ファイルヘッダ — barrel 分割の履歴

