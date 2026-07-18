# Checking Team 全コードベースレビューレポート

> 実施日: 2026-07-18 05:22
> レビュー対象: 全コードベース（main ブランチ）
> 実行方式: 並列（Wave 1: 5観点 → Wave 2: 4クラスタ）
> レビュー観点: 21/22（Test Experts 未実行）

---

## 総合評価: 87/100 (ランク: B)

| ランク | スコア範囲 | 評価 |
|:-----:|:---------:|:----|
| **B** | **80-89** | 良好だが、対処すべき重要な課題が複数存在する |

### 観点別スコア一覧

| 観点 | スコア | High | Medium | Low |
|------|:-----:|:----:|:-----:|:---:|
| **Wave 1: コアレビュアー** | | | | |
| Red Team Leader | **55** | 2 | 1 | 0 |
| Blue Team Leader | **85** | 0 | 3 | 0 |
| System Architect | **85** | 1 | 2 | 0 |
| Maintainability Guardian | **70** | 1 | 2 | 0 |
| Legacy Bridge Architect | **70** | 1 | 2 | 0 |
| **Wave 2: UX/Frontend** | | | | |
| UI Expert | **90** | 0 | 2 | 1 |
| Accessibility Advocate | **90** | 0 | 2 | 1 |
| i18n Expert | **90** | 0 | 2 | 1 |
| Documentation Architect | **95** | 0 | 1 | 2 |
| **Wave 2: Ops/Performance** | | | | |
| Tuning Expert | **90** | 0 | 3 | 0 |
| SRE/Ops Specialist | **90** | 0 | 2 | 1 |
| FinOps Consultant | **90** | 0 | 2 | 1 |
| Edge & Mobile Strategist | **95** | 0 | 1 | 2 |
| **Wave 2: Governance/Risk** | | | | |
| Compliance & Privacy Guard | **90** | 0 | 2 | 0 |
| Ethics & Bias Auditor | **95** | 0 | 1 | 1 |
| Supply Chain & Dependency Sentinel | **90** | 0 | 2 | 1 |
| API & Contract Negotiator | **95** | 0 | 1 | 1 |
| **Wave 2: Code Quality** | | | | |
| Domain Logic Expert | **90** | 0 | 2 | 1 |
| Data Integrity Expert | **85** | 0 | 3 | 0 |
| Refactoring Evangelist | **90** | 0 | 2 | 1 |
| DX Advocate | **95** | 0 | 1 | 2 |

---

## 重要指摘事項（優先度順）

### [High] SQLインジェクション — IdbVfsBackend.query() の ORDER BY インジェクション

- **指摘者**: Red Team Leader
- **場所**: `src/offscreen/IdbVfsBackend.ts:68-73`
- **影響**: `orderBy` / `orderDir` パラメータがSQL文字列にバリデーションなしで直接展開される。`opfsWorker.ts` では `ALLOWED_ORDER_COLUMNS` による許可リスト検証があるが、`IdbVfsBackend` には存在しないため、IDBフォールバックパスでのみ注入が可能。攻撃経路: Dashboard/Popup → DASHBOARD_SQLITE → sqliteClient.query() → offscreen → recordsRepo.query() → IdbVfsBackend.query()。ORDER BY句は式を受け付けるため、CASE式を使ったブーリアンベース暗号推論や UNION SELECT によるデータ抽出が可能。
- **対処**: `opfsWorker.ts` と同様に `ALLOWED_ORDER_COLUMNS` による許可リスト検証を `IdbVfsBackend.query()` に追加。`orderDir` は `['ASC', 'DESC']` のみ許可する。

### [High] APIキー暗号化の実質的無効化（マスターパスワード未設定時）

- **指摘者**: Red Team Leader, Blue Team Leader
- **場所**: `src/utils/storage/encryptionSession.ts:126-150`, `src/utils/storage/settingsStore.ts:252-269`
- **影響**: マスターパスワード未設定時（デフォルト）、暗号化キーは `ENCRYPTION_SECRET` (32バイト乱数) と `ENCRYPTION_SALT` からPBKDF2で導出される。この secret と salt は暗号文と同一の `chrome.storage.local` に平文で保存されている。`chrome.storage.local` にアクセスできる攻撃者はsecretとsaltを読み取り、全APIキーを復号できる。さらに `getSettings()` 呼び出し時に全APIキーが復号され、`cachedSettings` に平文で1秒間キャッシュされる。影響を受けるキー: OBSIDIAN_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, OPENAI_2_API_KEY, PROVIDER_API_KEY, GITHUB_PAT。
- **対処**: (a) デフォルトでマスターパスワード設定を必須にする、または初回起動時に設定を促すフローを追加する。(b) `chrome.storage.session`（ブラウザ閉鎖時に消失）に鍵シードを移動する。(c) `cachedSettings` のAPIキーを返却後に即座にクリアする。

### [High] レガシー chrome.storage.local への二重書き込みによる5MBクォータ枯渇リスク

- **指摘者**: System Architect
- **場所**: `src/background/pipeline/steps/saveMetadataStep.ts:45-220`, `dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md:103`
- **影響**: 1レコードの記録ごとに20+回の楽観的ロック付き `chrome.storage.local` 書き込みが発生。5MBハードクォータに達すると `purgeLegacyStorage()` が発動するが、これは対症療法であり、大規模データ削除途中のクラッシュで不整合状態が残るリスクがある。ADR自身が「根本的解決ではない」と認めている。
- **対処**: `LEGACY_DUAL_WRITE_ENABLED` フラグをデフォルト `false` に切り替え、レガシー履歴パネルと重複チェックをSQLiteベースに完全移行する。(1) `checkDuplicateStep` をSQLiteの UNIQUE(url, created_at) 制約で代替、(2) レガシー履歴パネルのSQLite版への完全統合、(3) URLキャッシュを `chrome.storage.session` に置き換え、(4) `saveMetadataStep` から全レガシー書き込みを削除。

### [High] デッドコード: 528行の aiSummaryCleansingSettings.ts が全く使用されていない

- **指摘者**: Maintainability Guardian
- **場所**: `src/popup/aiSummaryCleansingSettings.ts` (全528行)
- **影響**: 本番コードで参照されているのは V2 のみであり、V1 は完全なデッドコード。新しい開発者が両ファイルを読み比べて「どちらが正か」判断する時間的コストが発生。V2 側のJSDocにも誤ったファイル名が記載され、混乱を助長。
- **対処**: `src/popup/aiSummaryCleansingSettings.ts` を削除する。同ファイルにのみ存在するテスト (`src/popup/__tests__/aiSummaryCleansingSettings.test.ts`) の参照を V2 に統合する。

### [High] OPFS 復旧時マイグレーションで20項目以上のデータが欠落する

- **指摘者**: Legacy Bridge Architect
- **場所**: `src/background/migrationService.ts:434-448`
- **影響**: `migrateOpfsRecovery()` が呼び出す `convertFallbackRecord()` は、FallbackStorage のレコードを BrowsingLogRecord へ変換する際に 11 フィールドしかマッピングしていない。`buildInsertRecordFields()` (schema.ts:271-309) が扱う 31 フィールドと比較して、gist_synced, content, masked_count, cleansed_reason, ai_provider, ai_model, ai_duration_ms, obsidian_duration_ms, sent_tokens, received_tokens, original_tokens, cleansed_tokens, page_bytes, candidate_bytes, original_bytes, cleansed_bytes, ai_summary_* (4種), extracted_sentences_* (2種), fallback_triggered の20項目が欠落。OPFS利用不可→復旧したユーザーは全診断メタデータを失う。
- **対処**: `convertFallbackRecord()` を `buildInsertRecordFields()` と同じフィールドセットに修正する。`{ ...buildInsertRecordFields(record, record.domain ?? null), id: record.id }` で十分。

---

### [Medium] 重要度順（抜粋・全35件）

#### セキュリティ・データ保護

| # | 指摘 | 指摘者 | 場所 | 対処概要 |
|:-:|------|--------|------|---------|
| 1 | Content Script onMessage が sender.id を検証していない | Blue Team | `src/content/extractor.ts:893-921` | ハンドラ先頭で `sender.id !== chrome.runtime.id` の早期リターンを追加 |
| 2 | Math.random() フォールバックが暗号論的乱数でない | Blue Team | `src/utils/logger.ts:425` | `crypto.getRandomValues()` を使用するよう修正 |
| 3 | CSP wasm-unsafe-eval による攻撃表面積拡大 | Red Team | `wxt.config.ts:65` | `web_accessible_resources` を必要最小限に制限 |

#### ストレージ・データ整合性

| # | 指摘 | 指摘者 | 場所 | 対処概要 |
|:-:|------|--------|------|---------|
| 4 | IDB VFS 移行バックアップが 12 カラムしか保存しない | Legacy Bridge | `src/offscreen/sqliteEngineContext.ts:32-35` | `MIGRATION_BACKUP_COLUMNS` を全 31 カラムに拡張 |
| 5 | OPFS 復旧フラグ削除順序の誤り | Legacy Bridge | `src/background/migrationService.ts:412-415` | 削除順序を逆にするかアトミックな削除に変更 |
| 6 | optimisticLock の CAS 操作に競合ウィンドウ | Data Integrity | `src/utils/optimisticLock.ts:134-167` | 書き込み後に再検証ステップを追加 |
| 7 | STORAGE_QUOTA_BYTES が実際の Chrome クォータと乖離 | Data Integrity | `src/utils/storage/quota.ts:7` | `unlimitedStorage` 時はクォータチェックをスキップ |
| 8 | Offscreen ドキュメントからのログ消失 | Data Integrity | `src/utils/logger.ts:177-188` | Offscreen → SW へのメッセージ転送パスを実装 |

#### アーキテクチャ・パフォーマンス

| # | 指摘 | 指摘者 | 場所 | 対処概要 |
|:-:|------|--------|------|---------|
| 9 | SessionStore が session データに local ストレージを使用 | Tuning Expert | `src/background/sessionStore.ts:19-21` | `chrome.storage.session` に変更 |
| 10 | pendingSqliteQueue が1件ずつ個別INSERT | Tuning Expert | `src/background/pendingSqliteQueue.ts:61` | 既存の `insertBatch` を使用してバッチ化 |
| 11 | 全SQLite操作が単一 Mutex で直列化 | Tuning Expert | `src/background/sqliteClient.ts:78` | 読み取り専用操作と書き込み操作で別々の Mutex を使用 |
| 12 | RecordingLogic の static キャッシュ状態が不安定 | System Architect | `src/background/recordingLogic.ts:133-204` | キャッシュ保存に `queueMicrotask` ではなく即時書き込みを使用 |
| 13 | wa-sqlite が本番依存関係として残存 | System Architect | `package.json:79` | バンドルから除外する設定を追加 |
| 14 | リクエストフロー全体にトレース ID 不在 | SRE/Ops | Service Worker → Offscreen 全般 | メッセージに requestId を伝搬 |
| 15 | ストレージスキーマに明示的なバージョン番号がない | SRE/Ops | `src/offscreen/migrations.ts` | `schema_version` キーを導入 |
| 16 | トークン使用量の報告に一貫性がない | FinOps | `src/background/ai/providers/` | 推定値フラグを追加しダッシュボードに表示 |
| 17 | AI呼び出しごとに audit log が INSERT | FinOps | `src/background/aiClient.ts:78` | バッチ書き込みまたはフォールバック最終結果のみ記録 |
| 18 | 単一 Offscreen 文書が SQLite と AI 両方を処理 | Edge & Mobile | `src/offscreen/offscreen.ts` | 別々の Offscreen 文書に分割 |

#### UI・アクセシビリティ・i18n

| # | 指摘 | 指摘者 | 場所 | 対処概要 |
|:-:|------|--------|------|---------|
| 19 | Dashboard HTML の lang 属性が空文字（UI+a11y+i18n共通） | 複数 | `entrypoints/options/index.html:2` | `<html lang="en">` に変更 |
| 20 | popup と options に i18n.ts が重複 | UI Expert | `src/popup/i18n.ts`, `entrypoints/options/i18n.ts` | 共通モジュールに統合 |
| 21 | ダッシュボードサイドバーに role="tab" がない | Accessibility | `entrypoints/options/index.html:16-155` | `role="tablist"`, `role="tab"`, `aria-controls` を追加 |
| 22 | Permissions ページの lang とテキストが日本語ハードコード | i18n | `entrypoints/permissions/index.html` | data-i18n で翻訳可能に |
| 23 | ACCESSIBILITY.md のコード例が古いパス参照 | Documentation | `docs/ACCESSIBILITY.md:53` | 実際のファイルパスに更新 |

#### Governance・コンプライアンス

| # | 指摘 | 指摘者 | 場所 | 対処概要 |
|:-:|------|--------|------|---------|
| 24 | デフォルトのデータ保持期間が無制限 | Compliance | `docs/PRIVACY.md:41` | デフォルト保持期間を設定（例: 180日） |
| 25 | レガシー boolean 同意のバージョントラッキング欠落 | Compliance | `src/popup/privacyConsent.ts:34-41` | TODO 解消、再同意促進 |
| 26 | デフォルトプライバシーモードが cloud AI 送信 | Ethics | `src/utils/storage/defaults.ts:45` | 初回セットアップ時に明示的に選択させる |
| 27 | THIRD_PARTY_NOTICES が推移的依存を未カバー | Supply Chain | `THIRD_PARTY_NOTICES.md` | 自動生成ツールをCIに組み込み |
| 28 | wa-sqlite が caret range で指定 | Supply Chain | `package.json:79` | exact pinning に変更 |
| 29 | OpenAIProvider コンストラクタの複雑な分岐 | API | `src/background/ai/providers/OpenAIProvider.ts:27-76` | ProviderConfig インターフェースで型安全に分離 |

#### コード品質・保守性

| # | 指摘 | 指摘者 | 場所 | 対処概要 |
|:-:|------|--------|------|---------|
| 30 | sqliteHistoryPanel.ts 間でユーティリティ関数が重複 | Maintainability | `src/dashboard/sqliteHistoryPanel.ts` (2箇所) | 共通ユーティリティに抽出 |
| 31 | 単一ファイルの責務超過（800行超が複数） | Maintainability | `dashboard.ts`, `extractor.ts`, `opfsWorker.ts`, `stripExtended.ts`, `trustDb.ts` | 機能ごとに分割 |
| 32 | saveSqliteStep の楽観的ロックが実質的 no-op | Domain Logic | `src/background/pipeline/steps/saveSqliteStep.ts:18-22` | 楽観的ロックを削除 |
| 33 | 二重ログAPIの混在（addLog vs logInfo/logWarn/logError） | Domain Logic + Refactoring | `src/utils/logger.ts` | `addLog` を非推奨化し統一 |
| 34 | InsertableRecord と InsertRecordFields の重複定義 | Refactoring | `src/offscreen/schema.ts:145-309` | 中間形式を1つに統合 |
| 35 | tsconfig が __tests__ を型チェック対象から除外 | DX Advocate | `tsconfig.json:38` | `npm validate` に `type-check:test` を含める |

---

## コンフリクト調整結果

特筆すべきコンフリクトはなし。以下の関連指摘は System Architect の判断を優先して統一的に扱う:

| 関連トピック | 関係観点 | 判断 |
|------------|---------|------|
| APIキー暗号化 | Red Team [High], Blue Team [Medium] | Red Team の High 評価を採用（より攻撃者的視点で深刻度が高い） |
| Dashboard HTML lang="" | UI [Medium], a11y [Medium], i18n [Medium] | 単一の修正で3観点同時解決。対処優先度は Medium |
| 二重ログAPI | Domain Logic [Medium], Refactoring [Medium] | 両者同意見。System Architect としても統一を推奨 |
| wa-sqlite 依存 | System Architect [Medium]（バンドル）, Supply Chain [Medium]（pinning） | 両方対処が必要。pinning は即時対応可能、バンドル除外は別途検討 |

---

## 対象外としてスキップした観点

全コードベースレビューのため、関連性マップによるスキップは行わず、全21観点を実行した。

---

## 未完了の観点

なし（全21観点が正常完了）

---

## 評価サマリ

| 指標 | 値 |
|------|:--:|
| 総合スコア | 87/100 |
| ランク | B |
| 実行観点数 | 21/22（Test Experts 未実行） |
| 観点別スコア範囲 | 55-95 |
| High 指摘（重複排除後） | 5件 |
| Medium 指摘（重複排除後） | 35件 |
| Low 指摘（重複排除後） | 16件 |

### 観点別スコア分布

| Score Range | Perspectives | Count |
|:-----------:|:------------|:-----:|
| 90-100 (S) | UXクラスタ4, Ops/Performance 2, Governance 3, CodeQuality 2, Blue Team | 12 |
| 80-89 (A) | System Architect, Data Integrity, Blue Team | 3 |
| 70-79 (B) | Maintainability, Legacy Bridge | 2 |
| 60-69 (C) | (なし) | 0 |
| 50-59 (D) | Red Team | 1 |
| 0-49 (E) | (なし) | 0 |

### 強み（複数観点から評価された良好点）

- **メッセージバリデーション**: Service Worker と Offscreen Document での多段階 sender 検証（Red Team, Blue Team, System Architect）
- **CSP 設定**: `default-src 'none'` ベース、connect-src の最小権限設計（Red Team, Blue Team）
- **PII マスキング**: 包括的な正規表現 + ReDoS対策（Red Team, Blue Team, Compliance）
- **暗号化実装**: PBKDF2 + AES-GCM の正しい実装（Red Team, Blue Team）
- **SQL パラメータ化**: ORDER BY 以外は全箇所で適切にパラメータ化（Red Team）
- **ADR 記録**: 27件のアーキテクチャ決定記録（System Architect）
- **テストカバレッジ**: 231テストファイル、~53%のテストコード比率（DX Advocate, Maintainability）
- **エラーハンドリング**: ErrorCode 列挙型の一貫した使用（Maintainability, Domain Logic）

### 弱み（重点 improvement 領域）

1. **データストレージの二重管理**: レガシー chrome.storage と SQLite の二重書き込みにより、5MBクォータ枯渇リスクとマイグレーション不完全性（OPFS復旧20項目欠落、IDBバックアップ12カラムのみ）が存在。System Architect + Legacy Bridge + Data Integrity の3観点が同時に問題を指摘。
2. **暗号化の実効性**: 技術的には正しいが、鍵管理の設計（鍵と暗号文の同一ストレージ）により実質的に暗号化が無効化されている。Red Team [High] + Blue Team [Medium] の二重指摘。
3. **大規模ファイルの責務超過**: 800行超のファイルが5つ存在。Maintainability + Refactoring の両観点が指摘。
4. **デフォルト設定のプライバシー**: デフォルトのデータ保持無制限 + cloud AI 送信は、Compliance + Ethics の両観点が問題視。

---

*Report generated by Checking Team (21 perspectives, parallel execution)*
