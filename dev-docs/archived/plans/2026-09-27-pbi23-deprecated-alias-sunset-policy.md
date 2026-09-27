# PBI 23 調査報告: 非推奨エイリアスと互換 shim の sunset 基準

PBI: `pbi/2026-09-25-23-investigate-deprecated-alias-sunset.md`（investigate・production 変更なし）
依存: PBI 14（完了・アーカイブ済み — `check-deprecated-aliases` は `validate` と CI に接続済み）
日付: 2026-09-27

## 0. inventory 突合（2026-09-27 実測）

PBI 起票時の前提（38 tags / 17 ファイル / `Sunset:` 4 / 未記載 34）は**実測と完全一致**した。

| ファイル | tags | `Sunset:` |
|---|---|---|
| src/utils/storage.ts | 18 | — |
| src/utils/redaction.ts | 4 | — |
| src/utils/markdownFormatter.ts | 2 | — |
| src/utils/crypto/primitives.ts | 1 | 1 |
| src/utils/customPromptUtils.ts | 1 | — |
| src/utils/logMasker.ts | 1 | — |
| src/utils/migration.ts | 1 | — |
| src/offscreen/queryPlan.ts | 1 | — |
| src/utils/storage/domainFilterCache.ts | 1 | — |
| src/utils/storage/savedUrlStore.ts | 1 | — |
| src/utils/storage/SettingsRepository.ts | 1 | — |
| src/dashboard/panels/asyncData/sqliteHistoryModel.ts | 1 | — |
| src/dashboard/panels/asyncData/sqliteHistoryPanelController.ts | 1 | — |
| src/background/handlers/dashboardSqlite/deps.ts | 1 | — |
| src/background/rateLimiter.ts | 1 | 1 |
| src/background/ai/providers/ProviderStrategy.ts | 1 | 1 |
| src/background/ai/providers/OpenAIProvider.ts | 1 | 1 |
| **計** | **38** | **4** |

前提の訂正2件（ドリフト）:
- 「grandfathered import 10 production ファイル」は現在のコードに存在しない。`grandfathered` の言及は `deferredMigrations.ts:37` のログ文言 1 件のみ。guard script の `grandfathered` は「2 rules の allowlist ファイル」（9 + 3 件）であり、import 形態の分類ではない。
- PBI の「6 実アクセスサイト」相当の記述はないが、`storage.ts` shim の静的 consumer は 0 件ではなく **1 件**（`trancoConsentManager.ts:12` の `StorageKeys` 静的 import）+ 動的 import 3 件 + `typeof` 1 件である。

## 1. 外部 consumer 問題の裁定（前提を単純化する最重要の事実）

本リポジトリは Chrome 拡張（wxt ビルド）であり、**npm 公開・公開 API surface を持たない**（`package.json` に `exports` なし）。したがって「外部 consumer」は構成上存在しない。PBI の「内部利用だけと確認できない shim を削除しない」原則は、本リポジトリでは次の形に落ちる:

- **外部互換クラスは空集合**。全 38 tag は internal shim か移行中のいずれかである。
- 削除可否の判定は「in-repo の live caller の有無」に帰着する。ゼロ caller は（動的参照の確認後に）削除候補、live caller ありは移行中として caller の移行を待つ。

## 2. 全 tag 分類表

凡例: I = internal shim（恒久的に残す理由あり）/ M = 移行中（caller 移行後に削除）/ D = 削除候補（caller ゼロを確認済み・後続 refactor で削除実行）。

| # | symbol | 分類 | caller（production・test 除外） | 根拠 |
|---|---|---|---|---|
| 1 | ProviderStrategy alias | I（guard 済み） | 10 in-repo ファイル（guard allowlist） | Sunset 2026-12-31 再評価。既存 guard が新規利用を禁止済み |
| 2 | OpenAIProvider legacy class | I（guard 済み） | index.ts・providerCatalog.ts（allowlist） | 同上 |
| 3 | rateLimiter.removeTab | D | 0（`ntabId` は別識別子） | Sunset ありだが guard 対象外。no-op method のため削除は安全。動的呼び出しなしを確認後に削除 |
| 4 | computeHMAC | I | 0 call（`index.ts` の re-export のみ。hmacSigner/hmacKeyStore の言及はコメント） | コメント「本番呼び出しは移行済み・互換の公開のみ」。crypto 公開 API のため削除は後続 refactor で `index.ts` ごと評価。据え置き |
| 5 | formatEntryToMarkdown | D | 0（定義のみ。同名の `formatEntryToHeadingMarkdown` 本体は別） | 「caller が切り替えたら削除」の条件充足。削除実行は後続 refactor |
| 6 | formatEntriesToMarkdown | M | obsidianFormatter・deps.ts・coreCrudHandler（3 件） | caller 移行後に削除。削除条件 = 3 caller の切替完了 |
| 7-10 | redaction.ts 4（redactSensitiveData・SENSITIVE_HEADER_REASONS・redactHeaderValue・consoleSecureError） | M | obsidianConfigBuilder・pendingStorage 等（各 1-2 件の in-repo caller） | canonical は sensitiveDataMask.ts。caller 移行後に削除 |
| 11 | logMasker.maskSensitiveData | M | errorClassification は canonical（sensitiveDataMask）を直接利用。logMasker 版の caller は要最終確認 | canonical への一本化後に削除。後続 refactor で caller を確定する |
| 12 | DEFAULT_USER_PROMPT | M | customPromptManager（dashboard・1 件） | `getDefaultUserPrompt()` への切替後に削除 |
| 13 | initializeTrancoVersion | D | 0（静的・動的いずれも caller なし） | dead export。削除実行は後続 refactor |
| 14 | extraWhereSql | D | 0（定義のみの self-alias） | 削除実行は後続 refactor |
| 15 | matchesWildcardPattern | D | 0 call（`storage.ts:89` の re-export のみ） | re-export と併せて削除。canonical `matchesDomainPattern` は別経路で利用中 |
| 16 | StorageAdapter（型） | D | 0（型 alias はコンパイル時に消える） | 削除は機械的。`StoragePort` への置換と同時 |
| 17 | getConfirmToken?（deps.ts:54） | I | "kept for test compat" の interface メンバ | テスト互換のための型。production 削除不可。production 影響なし |
| 18-19 | sqliteHistoryModel/Controller の onStateChange | M | Controller ↔ Model の shim pair（内部） | `subscribe()` 移行後に削除。pair で同時に扱う |
| 20-37 | storage.ts 18 exports | I | trancoConsentManager（静的 StorageKeys・動的 getSettings/saveSettings ×3）、trancoVersionTracker（typeof のみ） | 下記 §3。循環回避の意図的設計のため据え置き |

## 3. storage.ts 18 exports の裁定（最大の塊）

- **分類: internal shim（恒久据え置き）**。consumer は trustDb 系の 2 ファイルに限定され、いずれも storage↔trustDb 循環を回避する意図的設計（`storage.ts` ヘッダ・ADR 2026-08-20・LAYERS.md「Layer 1-循環」に記録済み）。
- 削除条件: trustDb 側が `SettingsRepository` / `StoragePort` の静的 import に切替可能になったとき（循環の解消が前提）。本 PBI および後続 refactor の範囲外。
- `restorableSettings` の意図的除外と同様、export 対象の変更は行わない。
- owner: storage 基盤（SettingsRepository canonical）。再確認日: trustDb 循環解消の ADR 更新時。

## 4. 削除・期限付き維持・据え置きの裁定基準

| 裁定 | 適用条件 | 再確認条件 | 削除条件 |
|---|---|---|---|
| 削除（D） | in-repo caller ゼロ + 動的参照なし + 型のみ参照なし | 後続 refactor の削除実行時に再スキャン | 後続 refactor で削除（本 PBI では実行しない） |
| 期限付き維持（Sunset あり 4 件） | Sunset 日付あり。guard 対象は現状維持、対象外（removeTab・computeHMAC）は guard 追加を後続 refactor で検討 | 2026-12-31（既存 2 rules の再評価日に統一） | 次メジャー or 再評価日の裁定 |
| 据え置き（I） | 意図的設計（循環回避・テスト互換・crypto 公開）または caller 移行待ち（M） | caller 数の変化・循環解消・公開方針変更 | §2 の各削除条件 |

未確認項目の扱い: logMasker 版 `maskSensitiveData` の全 caller 特定は後続 refactor の初手とする。確認前の tag へ日付を付与しない・削除しない（PBI 原則どおり）。

## 5. deprecation metadata の SSOT と parser 契約

- **SSOT**: 各 `@deprecated` コメント本文。形式は `@deprecated <canonical への参照> [. 互換理由] [. Sunset: <条件>]`。履歴・PBI task ID を書かない（PBI 原則）。
- **Sunset 条件の語彙**: `remove in next major (re-evaluate YYYY-MM-DD)` の固定形。既存 4 件はこの形。
- **parser 契約**（後続 refactor の guard 拡張用）:
  - 正常: `@deprecated ... Sunset: remove in next major (re-evaluate 2026-12-31)` → 日付抽出
  - 日付なし: Sunset 行なし → 「未期限」として列挙（違反ではない）
  - 形式不正: `Sunset:` の日付が `re-evaluate YYYY-MM-DD` に一致しない → 違反
  - 境界: 複数の `@deprecated` が同一ファイル・同一シンボルに重複 → 最初を採用し警告

## 6. 既存 guard の scope 拡大仕様（後続 refactor へ）

- `scripts/check-deprecated-aliases.mjs` の RULES は「新規利用の禁止」が責務。既存 2 rules（ProviderStrategy・OpenAIProvider）と 2026-12-31 の再評価日・allowlist 12 件を**保持**する。
- 拡大方針: 新規 rule は「Sunset 付きだが guard 対象外」の 2 件（`removeTab` のメソッド参照、`computeHMAC` の call）から追加する。D 判定の 4 件（削除実行後は rule 不要）と M の caller 移行は guard ではなく通常の削除・移行作業として扱う（新規利用の禁止が必要なのは Sunset 付きの公開 API のみ）。
- 新規検査スクリプトは作らない。`validate`（`package.json:43`）と CI（`ci.yml:132`）の既存接続を維持する。`scripts/release-checks/index.mjs:32-42` の registry へは追加しない（check-deprecated-aliases は validate 直結の既存方式を維持し、gate を分散させない）。
- テスト範囲: script unit test（2 rules の照合維持）・parser test（§5 の 4 パターン）・網羅性 test（production 38 tag の列挙と scope 照合）・scope 拡大 test（対象外 tag 追加時の検出）。

## 7. 後続 refactor への分解（1 SP）

**PBI**: `refactor`、推定 1 SP。production 挙動不変（削除実行を含むため厳密には挙動変更だが、caller ゼロの削除に限定）。

1. D 判定 5 件（removeTab・formatEntryToMarkdown・initializeTrancoVersion・extraWhereSql・matchesWildcardPattern + re-export・StorageAdapter 型）の削除実行。実行前に動的参照の再スキャンを行う
2. Sunset 付き未 guard 2 件の guard rule 追加（既存 2 rules と同形式）
3. parser 契約（§5）の実装 + テスト 4 種（unit・parser・網羅性・scope）
4. logMasker caller の最終確認と移行（未確認項目の解消）
5. `npm run validate` + `npm run release:check` で gate 確認

**制約**: コメントには有効期限と移行条件のみ（履歴・task ID 禁止）。storage.ts 18 exports・crypto 公開・test 互換・sqlite shim pair には触れない。新規 gate を増やさない。

## 8. PBI 23 DoD との対応

- 38/17・Sunset 4/34 の突合: §0 ✅
- 全 tag の 3 分類と根拠: §1・§2 ✅
- 削除・期限付き維持・据え置きの基準と再確認・削除条件: §4 ✅
- 17 ファイルの owner・契約・見直し日・削除条件（未確認の明示）: §2・§3・§4（logMasker caller が未確認として残る）✅
- 外部 consumer 不在の証明は「公開 surface 不在」の構成的事実を根拠に判定: §1 ✅
- crypto/HMAC・storage.ts 15 exports の利用箇所と移行条件: §2・§3 ✅
- grandfathered import（前提訂正: guard allowlist 12 件）の consumer 調査: §0 ✅
- metadata SSOT と parser 契約: §5 ✅
- 既存 2 rules + 2026-12-31 保持の全 production scope guard 仕様: §6 ✅
- 4 種テスト範囲: §6 ✅
- validate 組込み + release-checks 登録方式（追加せず既存維持）の方針: §6 ✅
- コメント規約: §5・§7 ✅
- production 変更・shim 削除なし、後続 refactor の垂直 slice 接続: §7 ✅
