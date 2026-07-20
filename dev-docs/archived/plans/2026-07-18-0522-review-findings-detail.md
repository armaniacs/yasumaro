# Checking Team 全コードベースレビュー — 指摘詳細

> 親レポート: [2026-07-18-0522-review-fullcodebase.md](2026-07-18-0522-review-fullcodebase.md)
> 実施: 2026-07-18 05:22 | 21観点 | 並列実行

---

## 凡例

```
- 状態: ✅ 修正済み / ⬜ 未着手 / ❓ 要確認（破壊的変更の可能性）
```

---

## [High] 未解決指摘

### H1 ⬜ APIキー暗号化の実質的無効化（マスターパスワード未設定時）

| 項目 | 内容 |
|------|------|
| 指摘者 | Red Team Leader [High], Blue Team Leader [Medium] |
| 場所 | `src/utils/storage/encryptionSession.ts:126-150`, `src/utils/storage/settingsStore.ts:252-269` |
| 影響 | マスターパスワード未設定時（デフォルト）、`ENCRYPTION_SECRET` と `ENCRYPTION_SALT` が暗号文と同一の `chrome.storage.local` に平文保存されるため、同ストレージにアクセスできる攻撃者は全APIキー（OBSIDIAN_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY, OPENAI_2_API_KEY, PROVIDER_API_KEY, GITHUB_PAT）を復号可能。さらに `getSettings()` 呼び出し時に全APIキーが復号され `cachedSettings` に平文で1秒間キャッシュされる。 |
| 対処案 | (a) デフォルトでマスターパスワード設定を必須化、または初回起動時に設定を促すフローを追加。 (b) `chrome.storage.session`（ブラウザ閉鎖時に消失）に鍵シードを移動。 (c) `cachedSettings` のAPIキーを返却後に即座にクリア。 |

---

### H2 ⬜ レガシー chrome.storage.local 二重書き込みによる5MBクォータ枯渇

| 項目 | 内容 |
|------|------|
| 指摘者 | System Architect |
| 場所 | `src/background/pipeline/steps/saveMetadataStep.ts:45-220`, `dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md:103` |
| 影響 | 1レコードの記録ごとに20+回の楽観的ロック付き `chrome.storage.local` 書き込みが発生。5MBハードクォータに達すると `purgeLegacyStorage()` が発動するが、大規模データ削除途中のクラッシュで不整合状態が残るリスク。ADR自身が「根本的解決ではない」と認めている。 |
| 対処案 | `LEGACY_DUAL_WRITE_ENABLED` フラグをデフォルト `false` に切り替え、レガシー履歴パネルと重複チェックをSQLiteベースに完全移行。 (1) `checkDuplicateStep` を SQLite の UNIQUE(url, created_at) 制約で代替。 (2) レガシー履歴パネルのSQLite版への完全統合。 (3) URLキャッシュを `chrome.storage.session` に置き換え。 (4) `saveMetadataStep` から全レガシー書き込みを削除。 |

---

## [High] 修正済み指摘

### H3 ✅ SQLインジェクション — IdbVfsBackend.query() ORDER BY インジェクション

| 項目 | 内容 |
|------|------|
| 場所 | `src/offscreen/IdbVfsBackend.ts:68-73` |
| 修正内容 | `ALLOWED_ORDER_COLUMNS` + `ALLOWED_ORDER_DIRECTIONS` 許可リスト検証を追加。`opfsWorker.ts` と同等の防御を適用。 |

### H4 ✅ OPFS復旧時マイグレーションで20+項目のデータ欠落

| 項目 | 内容 |
|------|------|
| 場所 | `src/background/migrationService.ts:434-448` |
| 修正内容 | `convertFallbackRecord()` を 11 フィールドから 31 フィールド（全カラム）に拡張。`buildInsertRecordFields()` と同様のデフォルト処理を適用。 |

### H5 ✅ デッドコード: aiSummaryCleansingSettings.ts (528行)

| 項目 | 内容 |
|------|------|
| 場所 | `src/popup/aiSummaryCleansingSettings.ts` |
| 修正内容 | V1ファイル削除。V2 JSDocとテストファイルのコメントを修正。 |

---

## [Medium] 指摘一覧

凡例: `[難易度: 簡単/中/難しい]` — 簡単は1ファイルの小修正、中は複数ファイルにまたがる、難しいは設計変更が必要

### M1 ⬜ [簡単] Content Script onMessage が sender.id を検証していない

- **場所**: `src/content/extractor.ts:893-921`
- **指摘者**: Blue Team Leader
- **影響**: `GET_CONTENT` メッセージ受信時に `sender.id` を検証していない。同一拡張機能内の別コンテンツスクリプトからの偽装メッセージを受信する可能性がある。他のハンドラでは検証済みで、ここだけ防御欠落。
- **対処**: ハンドラ先頭で `if (sender.id !== chrome.runtime.id) return;` を追加。

---

### M2 ⬜ [簡単] Math.random() フォールバックが暗号論的乱数でない

- **場所**: `src/utils/logger.ts:425`
- **指摘者**: Blue Team Leader
- **影響**: `crypto.randomUUID()` が利用不可の場合、`Math.random().toString(36).substring(2)` でログエントリIDを生成。`Math.random()` はCSPRNGではない。
- **対処**: `crypto.getRandomValues()` を使用するフォールバックに変更:
  ```ts
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return arr[0].toString(36) + arr[1].toString(36);
  ```

---

### M3 ⬜ [簡単] CSP web_accessible_resources が過剰に公開

- **場所**: `wxt.config.ts:65`
- **指摘者**: Red Team Leader
- **影響**: `web_accessible_resources` が `chunks/*.js` と `assets/*.js` を全Webページに公開。悪意あるWebサイトが拡張機能の内部モジュール形式やメッセージ構造を解析可能。
- **対処**: WAR の対象を必要最小限に制限する。

---

### M4 ⬜ [簡単] IDB VFS 移行バックアップが12カラムしか保存しない

- **場所**: `src/offscreen/sqliteEngineContext.ts:32-35`
- **指摘者**: Legacy Bridge Architect
- **影響**: wa-sqlite → @subframe7536 移行時の `MIGRATION_BACKUP_COLUMNS` が 31 カラム中 12 カラムしか SELECT しない。移行失敗時の復元で全診断カラムが NULL になる。
- **対処**: `MIGRATION_BACKUP_COLUMNS` を `COLUMN_NAMES`（全31カラム）と同じリストに拡張。

---

### M5 ⬜ [簡単] OPFS 復旧処理のフラグ削除順序が誤っている

- **場所**: `src/background/migrationService.ts:412-415`
- **指摘者**: Legacy Bridge Architect
- **影響**: 先に `FALLBACK_STORAGE_KEY` を削除し、その後 `OPFS_FALLBACK_MODE` フラグを削除。SWが2行の間で終了するとフォールバックデータ消失＋フラグ永遠残留。
- **対処**: 削除順序を逆にする（先にフラグ削除→後にデータ削除）。または `chrome.storage.local.remove(['key1', 'key2'])` でアトミックに実行。

---

### M6 ⬜ [中] optimisticLock の CAS 操作に競合ウィンドウが存在

- **場所**: `src/utils/optimisticLock.ts:134-167`
- **指摘者**: Data Integrity Expert
- **影響**: `performCasUpdate` の READ(142行目) と WRITE(164行目) の間に競合ウィンドウ。`chrome.storage.local` は真の CAS を提供しないため、2つの concurrent 書き込みがバージョンチェックを両方通過し、後者が前者を上書きする可能性あり。
- **対処**: 書き込み後に即座に再検証（re-read + compare）する検証ステップを追加。または不要な楽観的ロック呼び出しを削除して競合機会を減らす。

---

### M7 ⬜ [簡単] STORAGE_QUOTA_BYTES が実際のクォータと乖離

- **場所**: `src/utils/storage/quota.ts:7`
- **指摘者**: Data Integrity Expert
- **影響**: `STORAGE_QUOTA_BYTES = 5MB` と宣言されているが、chrome.storage.local のデフォルトクォータは 10MB で、本拡張機能は `unlimitedStorage` パーミッションを持つため事実上制限なし。`savedUrlStore.ts:86-90` で誤ったクォータエラーが送出されうる。
- **対処**: `unlimitedStorage` がある場合はクォータチェックをスキップ。定数を `chrome.storage.local.QUOTA_BYTES`（10MB）に合わせる。

---

### M8 ⬜ [中] Offscreen ドキュメントからのログ消失

- **場所**: `src/utils/logger.ts:177-188`
- **指摘者**: Data Integrity Expert
- **影響**: Offscreen Document では chrome.storage にアクセスできないため、`flushLogs` は `console.log` にフォールバックしてログを破棄する。SQLite操作のエラーログが永続化されない。コメントには「Service Worker にメッセージ転送」とあるが未実装。
- **対処**: Offscreen → Service Worker への `chrome.runtime.sendMessage` 経由でログを転送し、Service Worker 側で `flushLogs` を実行するパスを実装。

---

### M9 ⬜ [簡単] SessionStore が session スコープデータに local ストレージを使用

- **場所**: `src/background/sessionStore.ts:19-21`
- **指摘者**: Tuning Expert
- **影響**: `sw:` プリフィクスのキーを `chrome.storage.local` に保存。5MBクォータを消費し、設定データやURLキャッシュと競合。`chrome.storage.session`（クォータ非カウント）を使用すべき。
- **対処**: `SessionStore` のバックエンドを `chrome.storage.session` に変更。容量制限（~1MB）に注意。

---

### M10 ⬜ [簡単] pendingSqliteQueue が1件ずつ個別 INSERT

- **場所**: `src/background/pendingSqliteQueue.ts:61`
- **指摘者**: Tuning Expert
- **影響**: SW起動時にキュー内レコードを for ループで一件ずつ `sqliteClient.insert()` 呼び出し。N件の順次オフスクリーンラウンドトリップ（各10sタイムアウト）が発生。
- **対処**: 既存の `sqliteClient.insertBatch()` を使用してチャンク（50件単位）で一括挿入。

---

### M11 ⬜ [中] 全SQLite操作が単一 Mutex で直列化

- **場所**: `src/background/sqliteClient.ts:78`
- **指摘者**: Tuning Expert, Edge & Mobile Strategist
- **影響**: すべての SQLite 操作が `SqliteClient.msgOffscreen()` 内の Mutex で直列化。`HEALTH_CHECK` や `STATUS` のような読み取り専用操作も書き込み操作完了を待つ必要がある。
- **対処**: 読み取り専用操作（HEALTH_CHECK, STATUS, COUNT 等）と書き込み操作で別々の Mutex キューを使用。または直接送信パスを追加。

---

### M12 ⬜ [中] RecordingLogic の static キャッシュ状態が不安定

- **場所**: `src/background/recordingLogic.ts:133-204`
- **指摘者**: System Architect, Refactoring Evangelist
- **影響**: `RecordingLogic.cacheState` は static プロパティとして保持。`queueMicrotask` で非同期に保存されるため、SWがマイクロタスクより先に終了するとキャッシュ消失。`getSavedUrlsWithCache()` がキャッシュMap参照を直接返すため、呼び出し元のミューテーションで不整合。
- **対処**: (1) `queueMicrotask` ではなく `chrome.storage.session` の即時書き込み。 (2) `getSavedUrlsWithCache()` はキャッシュMapのコピーを返す。 (3) 理想的には `RecordingCacheManager` に抽出。

---

### M13 ⬜ [簡単] wa-sqlite が本番依存関係として残存

- **場所**: `package.json:79`
- **指摘者**: System Architect
- **影響**: `wa-sqlite` が `dependencies` に宣言されているが、使用箇所は旧DBバックアップとOPFS旧DB読み取りのみ。WXT/Rolldown バンドルに含まれる可能性があり、バンドルサイズを増加させる（wa-sqlite WASM 約1MB超）。
- **対処**: `overrides` またはビルド設定でバンドルから除外。または移行完了を加速し依存を完全除去。

---

### M14 ⬜ [中] リクエストフロー全体にトレース ID 不在

- **場所**: Service Worker → Offscreen → AI Provider の各段階（全体的）
- **指摘者**: SRE/Ops Specialist
- **影響**: メッセージ処理の logger エントリはIDを持つが、Offscreen や AI API コールのログに伝搬されない。障害時に「どの操作が原因でどのAPIコールが失敗したか」を追跡できない。
- **対処**: メッセージハンドラのエントリポイントで requestId を生成し、`logInfo`/`logError` の details に常に含める。Offscreen への payload にも `requestId` を含めレスポンスと相関させる。

---

### M15 ⬜ [中] ストレージスキーマに明示的なバージョン番号がない

- **場所**: `src/offscreen/migrations.ts`, `src/background/migrationService.ts`
- **指摘者**: SRE/Ops Specialist
- **影響**: 個別の migration フラグ（`OPFS_MIGRATION_V2_DONE` 等）で状態管理。ダウングレード時に新スキーマのデータと旧コードの互換性を検証できない。
- **対処**: `chrome.storage.local` および SQLite に `schema_version` キーを導入。`onInstalled` ハンドラでバージョン不一致を検出。

---

### M16 ⬜ [簡単] AI プロバイダ間でトークン使用量の報告に一貫性がない

- **場所**: `src/background/ai/providers/`, `src/background/aiClient.ts:83`
- **指摘者**: FinOps Consultant
- **影響**: 全プロバイダが正確なトークン数を返すとは限らない。LocalAIClient は文字数で代用。ユーザーがプロバイダ間のコスト比較ができない。
- **対処**: トークン推定値を計算する共通ユーティリティを追加。推定値であることを示すフラグを `sentTokens`/`receivedTokens` に付与。

---

### M17 ⬜ [簡単] AI 呼び出しごとに audit log が INSERT される

- **場所**: `src/background/aiClient.ts:78`
- **指摘者**: FinOps Consultant
- **影響**: すべての `generateSummary` 呼び出しで `recordAuditLog()` が実行。Priority list に3プロバイダあればフォールバックごとに最大3行/ページの audit log が INSERT。500ページ/日 → 1500行/日。
- **対処**: audit log の書き込みをバッチ化（10件または30秒ごとにまとめて INSERT）。またはフォールバックチェーンの最終結果のみ記録。

---

### M18 ⬜ [難しい] 単一 Offscreen 文書が SQLite と AI の両方を処理

- **場所**: `src/offscreen/offscreen.ts`, `src/background/sqliteClient.ts`, `src/background/localAiClient.ts`
- **指摘者**: Edge & Mobile Strategist
- **影響**: SQLite（OPFS）と Local AI（Prompt API）が同じ Offscreen 文書を共有。Chrome がメモリ不足でサスペンドすると両方同時に利用不可。特に Android Chrome で影響大。
- **対処**: SQLite 用と Local AI 用で別々の Offscreen 文書を作成。またはプロアクティブヘルスチェック（60秒間隔）を実装。

---

### M19 ⬜ [簡単] Dashboard HTML の lang 属性が空文字

- **場所**: `entrypoints/options/index.html:2`
- **指摘者**: UI Expert, Accessibility Advocate, i18n Expert（3観点同時指摘）
- **影響**: `<html lang="" dir="ltr">` — JS で動的に設定されるが、初期HTMLが空 lang のためJS読み込み前・失敗時に言語未確定。HTML仕様違反。スクリーンリーダーの言語識別不能。3観点が同時指摘。
- **対処**: `<html lang="en" dir="ltr">` に変更し、JSで上書き。

---

### M20 ⬜ [簡単] popup と options に i18n.ts が重複

- **場所**: `src/popup/i18n.ts`, `entrypoints/options/i18n.ts`
- **指摘者**: UI Expert
- **影響**: ほぼ同一の i18n ヘルパーが2箇所に存在。片方の修正が他方に反映されず動作乖離のリスク。
- **対処**: 共通の i18n モジュールに統合し、両方から import する。

---

### M21 ⬜ [簡単] ダッシュボードサイドバーとパネルのタブ関係が不完全

- **場所**: `entrypoints/options/index.html:16-155`
- **指摘者**: Accessibility Advocate
- **影響**: パネル要素に `role="tabpanel"` が付与されているが、サイドバーボタンに `role="tab"` や `aria-controls` がない。スクリーンリーダーがタブパターンとして認識できない。
- **対処**: サイドバーの `nav` に `role="tablist"`、各ボタンに `role="tab"` と `aria-controls` を追加。または `role="tabpanel"` を削除し単純セクションとして扱う。

---

### M22 ⬜ [簡単] Permissions ページの lang とテキストが日本語ハードコード

- **場所**: `entrypoints/permissions/index.html:2`（`lang="ja"`）, `entrypoints/permissions/index.html:11`（`読み込み中...`）
- **指摘者**: i18n Expert
- **影響**: i18n フック（`data-i18n`）がなく、英語ユーザー向け翻訳が一切適用されない。lang 固定でスクリーンリーダー発音も日本語に。
- **対処**: `data-i18n` 属性で翻訳可能にし、lang は i18n API から動的に設定。

---

### M23 ⬜ [簡単] ACCESSIBILITY.md のコード例が古いパス・APIを参照

- **場所**: `docs/ACCESSIBILITY.md:53`, `docs/ACCESSIBILITY.md:34`
- **指摘者**: Documentation Architect
- **影響**: `src/popup/utils/focusTrap.ts` → 実際は `src/utils/focusTrap.ts`。フォーカストラップの現APIと一致しないコード例。
- **対処**: 実際のファイルパスと現在の export 関数名に合わせて更新。

---

### M24 ⬜ [簡単] 設定画面タブ切り替え後にフォーカス移動がない

- **場所**: `src/popup/popup.ts:37-75`（`initTabNavigation`）
- **指摘者**: Accessibility Advocate
- **影響**: タブパネル切り替え後、フォーカスがアクティブボタンに残ったまま。WCAG 2.4.3 (Focus Order) の観点から問題。
- **対処**: パネル切替後に `activePanel.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')?.focus()` を追加。

---

### M25 ⬜ [簡単] デフォルトのデータ保持期間が無制限

- **場所**: `docs/PRIVACY.md:41`, `src/utils/storage/defaults.ts`
- **指摘者**: Compliance & Privacy Guard
- **影響**: デフォルト「無制限に保持」は GDPR Art.5(1)(e) データ最小化原則に照らして推奨できない。ユーザーが設定変更しない限り履歴が永続保存。
- **対処**: デフォルト保持期間を設定（例: 180日）。初回起動時にオンボーディングで説明。

---

### M26 ⬜ [簡単] レガシー boolean 同意のバージョントラッキング欠落

- **場所**: `src/popup/privacyConsent.ts:34-41`
- **指摘者**: Compliance & Privacy Guard
- **影響**: `TODO` コメントで自認されている通り、レガシー形式（`true` boolean）で同意したユーザーがポリシーバージョン更新後に再同意を促されない可能性。`migrateLegacyPrivacyConsent` 処理後でも稀にヒットするパス。
- **対処**: レガシーbooleanの読み取り時に強制的に再同意を促す。`PRIVACY_CONSENT_VERSION` チェックで保護。TODO の解消。

---

### M27 ⬜ [中] デフォルトプライバシーモードが cloud AI 送信

- **場所**: `src/utils/storage/defaults.ts:45`（`PRIVACY_MODE: 'masked_cloud'`）
- **指摘者**: Ethics & Bias Auditor
- **影響**: PIIマスク後とはいえ、ユーザーの閲覧コンテンツがデフォルトで外部AIプロバイダーに送信される。全ブラウジング行動の要約が第三者サーバーで処理。
- **対処**: 初回セットアップ時にプライバシーモードを明示的に選択させる。`local_only` が利用可能な環境ではそれをデフォルトにする。

---

### M28 ⬜ [簡単] THIRD_PARTY_NOTICES.md が推移的依存をカバーしていない

- **場所**: `THIRD_PARTY_NOTICES.md`（全75行）
- **指摘者**: Supply Chain & Dependency Sentinel
- **影響**: ランタイム依存3件のみ記載。`package.json` には 70+ の devDependencies + 推移的依存が存在。OSSとしてChrome Web Store公開する場合、全依存のライセンス表記が法的に望ましい。GPL/AGPL混入リスク。
- **対処**: `license-checker` や `generate-license-file` などのツールで推移的依存を含む THIRD_PARTY_NOTICES を自動生成する仕組みをCIに組み込む。

---

### M29 ⬜ [簡単] wa-sqlite が caret range で指定されている

- **場所**: `package.json:79`（`"wa-sqlite": "^1.0.0"`）
- **指摘者**: Supply Chain & Dependency Sentinel
- **影響**: 他の2つのランタイム依存が exact pinning なのに対し、全ユーザーデータを保存するSQLite WASMのみ `^` 指定。想定外のマイナーアップデートでデータ互換性が破壊されるリスク。
- **対処**: `"wa-sqlite": "1.0.0"` に変更し、明示的なアップグレードのみ許容。

---

### M30 ⬜ [中] OpenAIProvider コンストラクタの複雑なプロバイダー分岐

- **場所**: `src/background/ai/providers/OpenAIProvider.ts:27-76`
- **指摘者**: API & Contract Negotiator
- **影響**: 7以上のプロバイダー種別（openai, openai-compatible, lm-studio, ollama, openai2 等）を文字列分岐と snake_case キー名変換で処理。新しいプロバイダー追加時に既存の StorageKeys 構造を壊すリスク。
- **対処**: Provider 固有の設定を `ProviderConfig` インターフェースとして型安全に分離し、プロバイダーごとの Factory または Builder パターンを導入。

---

### M31 ⬜ [簡単] sqliteHistoryPanel.ts 間でユーティリティ関数が重複

- **場所**: `src/dashboard/sqliteHistoryPanel.ts` および `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`
- **指摘者**: Maintainability Guardian
- **影響**: `formatDate`, `formatTimestamp`, `escapeHtml`, `buildCleansingProgressBarHtml`, `formatDiagnosticMetadataHtml`, `t`, `PAGE_SIZE` の7ユーティリティが重複。
- **対処**: 共通ユーティリティを `src/dashboard/historyUtils.ts` に抽出し、両ファイルから参照。

---

### M32 ⬜ [簡単] saveSqliteStep の楽観的ロックが実質的な no-op

- **場所**: `src/background/pipeline/steps/saveSqliteStep.ts:18-22`
- **指摘者**: Domain Logic Expert
- **影響**: `withOptimisticLock` に `sqlite-write-{url}-{created_at}` キーを渡しているが、このロックは chrome.storage.local のバージョン管理に過ぎない。実際のSQLite書き込みは Offscreen へのメッセージパッシング経由で行われ、Mutex が直列化。楽観的ロックの READ(2回) + WRITE(1回) はレイテンシを増やすだけで整合性保護に寄与していない。
- **対処**: 楽観的ロックを削除。重複防止は Offscreen 側（UNIQUE(url, created_at) 制約）に任せる。

---

### M33 ⬜ [中] 二重ログAPIの混在（addLog vs logInfo/logWarn/logError）

- **場所**: `src/utils/logger.ts`（全コードベースで混在）
- **指摘者**: Domain Logic Expert, Refactoring Evangelist（両観点が同時指摘）
- **影響**: `addLog(type, message, details)` と `logInfo/logWarn/logError/logDebug(message, details, errorCode?, source?)` の2系統が併存。後者はエラーコードやソース情報を付加できるが前者はできない。新コードでも混在が続くと障害分析が困難に。
- **対処**: `addLog` を非推奨化（`@deprecated` JSDoc）。全箇所を `logInfo/logWarn/logError/logDebug` に統一するマイグレーションを実施。

---

### M34 ⬜ [中] InsertableRecord と InsertRecordFields の重複定義と builder 関数の重複

- **場所**: `src/offscreen/schema.ts:145-309`
- **指摘者**: Refactoring Evangelist
- **影響**: `buildInsertParams`(186-224行) と `buildInsertRecordFields`(271-309行) が ~60行ずつ同じデフォルトロジックを実装。カラム追加時に4箇所を同時更新する必要がありバグの原因に。
- **対処**: 「デフォルト値を適用する中間形式」を1つにし、両関数はその中間形式からの変換に絞る。または `InsertRecordFields` のみを source of truth とし、位置パラメータはそこから派生させる。

---

### M35 ⬜ [簡単] tsconfig が __tests__ を型チェック対象から除外している

- **場所**: `tsconfig.json:38`
- **指摘者**: DX Advocate
- **影響**: `"exclude": ["src/**/__tests__"]` によりテストファイルが型チェック除外。`type-check:test` は別スクリプトだが `npm test` や `npm run type-check` では実行されずCIでの確認漏れリスク。
- **対処**: `npm validate` に `type-check:test` を含める。または tsconfig の `references` 機能でテスト用プロジェクト参照を設定。

---

## [Low] 指摘一覧（16件 — スコア非影響）

### L1 ⬜ ポップアップの幅が 360px 固定
- **場所**: `entrypoints/popup/styles.css:112`
- **対処**: `min-width: 360px; max-width: 100vw;` への変更を検討

### L2 ⬜ README にアーキテクチャ図がない
- **場所**: `README.md`
- **対処**: Mermaid 等のアーキテクチャ図を追加

### L3 ⬜ README のプライバシー機能が目立たない
- **場所**: `README.md:34-50`
- **対処**: セキュリティ・プライバシー機能の専用セクションを追加

### L4 ⬜ 複数形・数量のロケール対応がない
- **場所**: `public/_locales/en/messages.json`
- **対処**: Chrome i18n の `plural` カテゴリを使用

### L5 ⬜ Offscreen Mutex 200 キュー上限 (モバイル)
- **場所**: `src/background/sqliteClient.ts:78`
- **対処**: モバイルでは上限を50に、リングバッファに変更

### L6 ⬜ コンテンツスクリプトのバンドルサイズ 92KB
- **場所**: `dist/chromium-mv3/content-extractor.js`
- **対処**: コード分割と遅延読み込みを検討

### L7 ⬜ 各 record() で新しい Pipeline インスタンス生成
- **場所**: `src/background/recordingLogic.ts:396-401`
- **対処**: 軽量プレビューパイプラインを返すファクトリ

### L8 ⬜ ログストレージと永続データが同じ5MBクォータ共有
- **場所**: `src/utils/logger.ts:111-112`
- **対処**: ログ保持期間を短縮（3日）、MAX_LOGS を500に

### L9 ⬜ 全ページ監視の透過性不足
- **場所**: `entrypoints/content/index.ts:7`
- **対処**: センシティブ領域でバッジ通知を表示

### L10 ⬜ uuid override が緩すぎる (`>=11.1.1`)
- **場所**: `package.json:85`
- **対処**: `"uuid": "^11.1.1"` に緩和

### L11 ⬜ Content-SW メッセージプロトコルにバージョニングなし
- **場所**: `src/background/messageTypes.ts`
- **対処**: `protocolVersion` を追加

### L12 ⬜ ログ呼び出しで source パラメータが省略
- **場所**: `RecordingPipeline.ts`, `saveSqliteStep.ts` 他多数
- **対処**: `import.meta.url` から自動補完するヘルパーを導入

### L13 ⬜ recordingLogic CacheState に静的/インスタンスメソッド混在
- **場所**: `src/background/recordingLogic.ts:129-392`
- **対処**: 独立したモジュール関数に抽出

### L14 ⬜ 231テストファイルのメンテナンス負荷
- **場所**: `src/**/__tests__/` 全般
- **対処**: テストファイル統合を検討

### L15 ⬜ バレル再エクスポート層がモジュール探索を困難に
- **場所**: `src/utils/storage.ts`, `src/offscreen/sqlite.ts` 他
- **対処**: バレルに `@deprecated` JSDoc 追加

### L16 ⬜ uuid override が緩すぎる
- **場所**: `package.json:85`
- **対処**: `^11.1.1` に緩和

---

## 実行者別指摘数サマリ

| 観点 | スコア | High | Medium | Low |
|------|:-----:|:----:|:-----:|:---:|
| Red Team Leader | 55 | 2 (1 fix済) | 1 | 0 |
| Blue Team Leader | 85 | 0 | 3 | 0 |
| System Architect | 85 | 1 (未着手) | 2 | 0 |
| Maintainability Guardian | 70 | 1 (fix済) | 2 | 0 |
| Legacy Bridge Architect | 70 | 1 (fix済) | 2 | 0 |
| UI Expert | 90 | 0 | 2 | 1 |
| Accessibility Advocate | 90 | 0 | 2 | 1 |
| i18n Expert | 90 | 0 | 2 | 1 |
| Documentation Architect | 95 | 0 | 1 | 2 |
| Tuning Expert | 90 | 0 | 3 | 0 |
| SRE/Ops Specialist | 90 | 0 | 2 | 1 |
| FinOps Consultant | 90 | 0 | 2 | 1 |
| Edge & Mobile Strategist | 95 | 0 | 1 | 2 |
| Compliance & Privacy Guard | 90 | 0 | 2 | 0 |
| Ethics & Bias Auditor | 95 | 0 | 1 | 1 |
| Supply Chain & Dependency Sentinel | 90 | 0 | 2 | 1 |
| API & Contract Negotiator | 95 | 0 | 1 | 1 |
| Domain Logic Expert | 90 | 0 | 2 | 1 |
| Data Integrity Expert | 85 | 0 | 3 | 0 |
| Refactoring Evangelist | 90 | 0 | 2 | 1 |
| DX Advocate | 95 | 0 | 1 | 2 |
| **合計** | | **5** (3 fix済) | **35** | **16** |

---

*Generated by Checking Team (21 perspectives) — 2026-07-18*
