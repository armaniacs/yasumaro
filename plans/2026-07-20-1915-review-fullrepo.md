# Checking Team レビュー結果 — Yasumaro (全リポジトリ)

- レビュー対象: 全リポジトリ (workspace root: obsidian-smart-history, main @ 0636bca)
- 比較ブランチ: なし (全体レビュー)
- 実行方式: 並列 (Wave1: 5観点 / Wave2: 4クラスタ・16観点 = 計21観点を個別スコア算出)
- 実行日: 2026-07-20
- ルール適用: プロジェクト固有パターン(🎯) — web_accessible_resources 分割漏れ、ESM .js 拡張、SW ステートレス、OPFS トランザクション順序、`.env` 非読取

---

## 総合評価: 75.5/100 (ランク: B)

21観点の単純平均。セキュリティ基盤(暗号化・URL検証・XSS対策)は堅牢だが、OPFS/SQLite のトランザクション整合、SW ライフサイクル周りのタイマー利用、i18n/CSS の局所的な不備、依存関係の脆弱性が分散しており、High 指摘が複数存在する。

---

## 重要指摘事項（優先度順）

### [High] 🎯 OPFS Worker の init パスに `PRAGMA journal_mode=WAL` が欠落
- 指摘者: Data Integrity Expert (Code Quality クラスタ)
- 場所: `src/offscreen/opfsWorker.ts:91-118` (`initSqliteInner`)
- 影響: IDB パス (`sqliteEngineContext.ts:290`) では schema 実行前に WAL を設定しているが、OPFS パスでは設定されていない。WAL 不在は並行アクセス時の読み書きブロック・性能低下を招く。Line 562 の checkpoint も「WAL でない場合は無視」のため実質無効。
- 対処: `engine.exec(SCHEMA_SQL)` の直前に `await engine.exec('PRAGMA journal_mode=WAL;')` を追加。

### [High] 🎯 `handleInsertBatch` が `BEGIN IMMEDIATE` ではなく `BEGIN` (DEFERRED) を使用
- 指摘者: Data Integrity Expert
- 場所: `src/offscreen/opfsWorker.ts:356`
- 影響: デフォルト `BEGIN` は最初の書き込みまでロックを取得しないため、並行アクセス時に `SQLITE_BUSY` のリスク。また L361 の `inserted++` ローカルカウンタは `INSERT OR IGNORE` の重複を実数として数えず、統計が不正確。
- 対処: `BEGIN` → `BEGIN IMMEDIATE`。カウンタを削除し COMMIT 直後に `SELECT changes()` を1回実行。

### [High] 🎯 `PRIVACY_POLICY_VERSION` が PRIVACY.md の最終更新日と不整合 — 再同意機構が機能しない
- 指摘者: Compliance & Privacy Guard
- 場所: `src/popup/privacyConsent.ts:11` (`'2026-02-23'`) vs `docs/PRIVACY.md:3` (2026-06-20)
- 影響: v6.0.1 (GDPR 修正・30日ルール) 等の変更後も定数がバンプされておらず、既存ユーザーへ再同意が促されない。GDPR Art.7 抵触の可能性。
- 対処: 定数を `'2026-06-20'` に更新し、既存ユーザーへポリシー変更通知のマイグレーションを追加。

### [High] gistSyncTarget.syncBatch() が最新5件のみ参照 — 未同期レコードが取り残される
- 指摘者: Domain Logic Expert
- 場所: `src/background/syncTargets/gistSyncTarget.ts:72-75`
- 影響: `query({ limit: 5, orderDir: 'DESC' })` で最新5件のみ取得し、その中で未同期をフィルタ。未同期が101件以上で最新5件が同期済みなら、残りは永遠に同期されない。バックアップが静的欠損。
- 対処: クエリに `gist_synced = 0` フィルタを追加し、LIMIT はページネーション(OFFSET ループ)で管理。

### [High] API レスポンススキーマの未検証 — コントラクト逸脱時にサイレント障害
- 指摘者: API & Contract Negotiator
- 場所: `src/background/ai/providers/OpenAIProvider.ts:274-282`, `GeminiProvider.ts:204-216`
- 影響: `data.choices[0].message.content` / `candidates[0].content.parts[0].text` を無条件に読取。プロバイダが形式変更すると undefined になり "No summary generated." がサイレント返却。
- 対処: 各 `_extractSummary` で必須フィールド存在確認と型チェックを追加。不整合時はエラーログ + フォールバックプロバイダへ。

### [High] Content script の `setInterval` + scroll listener が全ページのメインスレッドに負荷
- 指摘者: Tuning Expert
- 場所: `src/content/extractor.ts:799` (setInterval 1s), `:828` (scroll listener)
- 影響: 全ページで毎秒ポーリング + スクロール時 DOM アクセス。モバイル・ヘビーページでフレームドロップ/入力遅延。
- 対処: scroll 監視を `IntersectionObserver` へ。ポーリングを `requestIdleCallback` へ。storage 読取は単一 `get('settings')` に統合。

### [High] 🎯 Logger の flush に `setTimeout` を使用 — SW 終了時にログ消失
- 指摘者: SRE/Ops Specialist
- 場所: `src/utils/logger.ts:235` (setTimeout), `:247` (`void flushLogs(true)` in onSuspend)
- 影響: プロジェクト既知ルール「Use alarms not timers」に反する。SW が flush 前に終了すると保留ログが全損。onSuspend の flush は `void` で await されず完了保証なし。
- 対処: flush を即時実行(バッファ閾値到達時) または `chrome.alarms` へ。onSuspend は `await flushLogs(true)` + 3s タイムアウト(Promise.race)。

### [High] プロバイダ別・月次のトークン消費ハードリミットが存在しない
- 指摘者: FinOps Consultant
- 場所: `src/background/ai/providers/ProviderStrategy.ts:69-87`, `src/utils/aiUsageTracker.ts:164-182`
- 影響: 月間100万トークンのソフト警告のみでハードストップなし。記録量の多いユーザーに予期せぬ API 課金リスク。
- 対処: `maxMonthlyTokens` 設定キーを追加し超過時にリクエストをブロック。UI で残トークン表示。

### [High] 🎯 Popup HTML に viewport meta タグが欠落
- 指摘者: Edge & Mobile Strategist
- 場所: `entrypoints/popup/index.html:4-10` (options/permissions/wizard には存在)
- 影響: Android Chrome で popup 表示時にビューポートスケーリングが崩れレイアウト破綻。
- 対処: 全 extension HTML エントリポイントに `<meta name="viewport" content="width=device-width, initial-scale=1.0">` を追加。

### [High] adm-zip の HIGH 脆弱性が推移的依存関係に存在 (CVSS 7.5)
- 指摘者: Supply Chain & Dependency Sentinel
- 場所: `package.json` → `firefox-profile → web-ext-run → wxt` (GHSA-xcpc-8h2w-3j85)
- 影響: `npm audit` で HIGH 4件。`wxt` のアップデートで解消されるか監視が必要。ビルドパイプライン攻撃ベクタ。
- 対処: `wxt` の更新を追跡。`overrides` で `"adm-zip": ">=0.6.0"` 適用可否を検討(CI で検証)。

### [High] 🎯 Global mutable state: `conflictStats` が SW 再起動で消失し、かつプロダクション参照なし
- 指摘者: System Architect
- 場所: `src/utils/optimisticLock.ts:19`
- 影響: プロジェクトルール「SW はグローバルに状態を保存しない」に違反。かつ `getConflictStats()` はテストからのみ参照 = 事実上デッドコード。
- 対処: 実用価値がなければ `conflictStats` / `getConflictStats` / `resetConflictStats` を削除。

### [High] ObsidianClient._fetchWithTimeout が中央の URL/CSP 検証をバイパス
- 指摘者: Red Team Leader
- 場所: `src/background/obsidianClient.ts:69-77, 236-301`
- 影響: ネイティブ `fetch()` を直接使用し `src/utils/fetch.ts` の `validateUrl` / `CSPValidator` / `allowedUrls` / リトライを通過しない。現在は `127.0.0.1` ハードコードで SSRF 実害は低いが、将来の拡張で未検証 URL リクエストの経路になり得る。
- 対処: `_fetchWithTimeout` を `src/utils/fetch.ts` の `fetchWithTimeout` に統合。

---

### [Medium] マスターパスワード未設定時の暗号化 secret が `chrome.storage.local` に保存 (設計上の既知弱点)
- 指摘者: Red Team Leader (🎯)
- 場所: `src/utils/storage/encryptionSession.ts:127-152`
- 影響: 未設定時、`encryption_secret`(32B乱数) + salt が平文保存。同一ストレージにアクセスできる悪意拡張に PBKDF2+AES-GCM 復号を許す。コード内で「脆弱だが維持」と認識済み。
- 対処: 未設定時も `chrome.storage.session`(SW メモリのみ) にキーを置く、または master-password 必須化を検討。破壊的変更のため要ユーザー判断。

### [Medium] 🎯 Dual message-type definitions が乖離 (`messaging/types.ts` vs `background/messageTypes.ts`)
- 指摘者: System Architect / Legacy Bridge (🎯)
- 場所: `src/messaging/types.ts:159`, `src/background/messageTypes.ts:72-75`
- 影響: `SAVE_RECORD` が types.ts で `payload: never` だが実ハンドラは title/url/content 等を読取。二重定義でメンテ倍増・型安全性喪失。
- 対処: 一方を唯一の定義とし、他は再エクスポートの薄いブリッジに。

### [Medium] 🎯 ダッシュボード「テキスト品質設定」が全編ハードコード日本語 (i18n 違反)
- 指摘者: UI Expert / i18n Expert (🎯)
- 場所: `entrypoints/options/index.html:801-835`
- 影響: `data-i18n` 欠如。英語ユーザーに機械翻訳されない固定文字列。
- 対処: 全表示文字列に `data-i18n` を付与し ja/en 両 messages.json にキー追加。

### [Medium] 🎯 entrypoint HTML の CSP に `style-src 'self' 'unsafe-inline'` が残存
- 指摘者: UI Expert (🎯)
- 場所: `entrypoints/popup/index.html:7`, `entrypoints/options/index.html:7`
- 影響: `wxt.config.ts` の `extension_pages` CSP は `style-src 'self'` に厳格化済みだが、entrypoint HTML の meta CSP は `unsafe-inline` のまま。インラインスタイルは実態ゼロのため不要。将来の混入検出が甘くなる。
- 対処: HTML meta の `unsafe-inline` を削除 (または `wxt.config` の CSP を唯一のソースとし meta を削除)。

### [Medium] 🎯 L1 ローカルAI が PII マスキング前に生コンテンツを受信
- 指摘者: Compliance & Privacy Guard (🎯)
- 場所: `src/background/privacyPipeline.ts:99-106`
- 影響: L1 ローカル要約が L2 PII マスクより先。ローカルは外部漏洩低いが、ユーザー想定(PII 先適用)と異なる。`local_only` ではマスク漏れの要約が保存される。
- 対処: L1 前に L2 相当のマスク適用、または UI で明示。

### [Medium] ロケールフォールバックの不適切なマッピング (zh→ja, ko→en)
- 指摘者: Ethics & Bias Auditor
- 場所: `src/utils/customPromptUtils.ts:81-87`
- 影響: 中国語話者に日本語プロンプトを強制(根拠不明)。公平性観点から不適切。
- 対処: zh は en へフォールバック、または言語選択をユーザー明示設定に。

### [Medium] 🎯 ObsidianClient ベース URL ホストが `127.0.0.1` 固定 / 🎯 Gemini エンドポイント `v1beta` 固定
- 指摘者: API & Contract Negotiator (🎯)
- 場所: `src/background/obsidianClient.ts:133`, `GeminiProvider.ts:60`
- 影響: WSL2/Docker/IPv6 で Obsidian 接続不可。`v1beta` 非推奨時全 Gemini 停止。
- 対処: `OBSIDIAN_HOST` / `gemini_api_version` 設定キーを追加しデフォルト維持で上書き可能に。404/410 時のフォールバック実装。

### [Medium] Dashboard サイドバー区切りが `<div>` (見出し未使用) / tablist に roving tabindex なし
- 指摘者: Accessibility Advocate
- 場所: `entrypoints/options/index.html:23,107,137` 他
- 対処: 区切りを `<h2>` または `role="heading"` に。tablist に roving tabindex + 矢印キー移動。

### [Medium] `triggerTabClose` 系が en に不在 / `confirmImport` が ja で重複定義
- 指摘者: i18n Expert
- 場所: `public/_locales/en/messages.json`, `public/_locales/ja/messages.json:773,879`
- 対処: en にキー追加。ja の重複を解消(別キー化または削除)。

### [Medium] 🎯 AGENTS.md アーキテクチャ図が実配置と乖離 (src/dashboard/dashboard.html → entrypoints/options/index.html) / `npm build` → `npm run build`
- 指摘者: Documentation Architect (🎯)
- 場所: `AGENTS.md:71-76, 40`
- 対処: パスを WXT 構造(`entrypoints/`)に合わせ修正。`npm build` → `npm run build`。

### [Medium] その他 (Low/Medium 群)
- handlePurgeOldRecords の二段 DELETE が単一トランザクションでない (`opfsWorker.ts:431-463`) — BEGIN IMMEDIATE/COMMIT でラップ。
- CI が type-check と test を単一ステップ (`npm run validate`) で実行 — 別ステップ化。
- `make test` が build+validate+E2E 直列でフィードバック長い — `test-quick`/`test-unit` 追加。
- runtime 依存が全ピン留め(`wa-sqlite@1.0.0` 等) — `~` で patch-range に。
- レート制限 10 req/min ハードコード — `AI_RATE_LIMIT_MAX` 設定化。
- コンテンツ長の動的切り詰めなし(一律10k文字) — モデル別 `maxContentChars`。
- AI プロバイダ障害の集約/アラート経路なし — エラーカウンタ + 通知。
- domainFilter の save 関数が DOM と storage を直接結合 — 中間モデル導入。
- `extractDomain` が3箇所重複 — `src/utils/domainUtils.ts` に統合。
- `<title>` ハードコード英語 — JS で `getMessage` 設定。
- リポジトリルート `.env` が存在(gitignored) — `.env.example` へのリネーム推奨。

---

## コンフリクト調整結果

- **Red Team「web_accessible_resources が chunks/*.js を全サイト公開 = High」**：System Architect の判断を優先し **Downgrade → Medium/設計上必要**。WXT コンテンツスクリプトのチャンク動的インポートに `chunks/*.js` / `assets/*.js` の公開は必須(拡張機能自身のバンドルであり secret ではない)。真の `🎯 web_accessible_resources` リスクは「分割時の更新漏れで自動保存停止」(既知障害) の再発であり、現状の WAR パターンを CI チェックリスト化すべき。
- **Data Integrity「OPFS WAL 欠落」**：自検証により **Valid を確認** (IDB パスのみ WAL 設定、OPFS init パスにはなし) → High 維持。
- **Red Team「平文キー保存 = High」**：`encryptionSession.ts` の設計上の既知弱点(コメントで自己言及)と判明 → **High → Medium** へ調整。マスターパスワード未設定時の obfuscation 的保存であり、暗号化スキーム自体(PBKDF2+AES-GCM)は堅牢。

---

## 対象外としてスキップした観点

なし (全21観点を実行。関連性マップによるスキップなし — 全リポジトリレビューのため)。

---

## 未完了の観点

なし (全観点が結果ファイルを出力)。

---

## 観点別スコア一覧

| 観点 | スコア | High/Med |
|------|------:|---------|
| Red Team Leader | 40 | 3H (うち1件は調整済) |
| Blue Team Leader | 85 | 3M |
| System Architect | 80 | 1H 1M 1L |
| Maintainability Guardian | 70 | 1H 2M |
| Legacy Bridge Architect | 85 | 2M 1L |
| UX/UI Expert | 70 | 1H 2M |
| Accessibility Advocate | 95 | 2M |
| i18n Expert | 70 | 1H 2M |
| Documentation Architect | 75 | 1H 1M |
| Tuning Expert | 75 | 1H 2M |
| SRE/Ops Specialist | 70 | 1H 2M |
| FinOps Consultant | 75 | 1H 2M |
| Edge & Mobile Strategist | 75 | 1H 2M |
| Compliance & Privacy | 75 | 1H 2M |
| Ethics & Bias | 95 | 1M |
| Supply Chain | 75 | 1H 1M |
| API & Contract | 70 | 1H 2M |
| Domain Logic | 75 | 1H 1M |
| Data Integrity | 55 | 2H 1M |
| Refactoring Evangelist | 90 | 2M |
| DX Advocate | 85 | 3M |

---

## 次フェーズ (Phase 5) について

High/Medium 指摘が多数あるため、自動修正フェーズへ進む。ただし全リポジトリ対象かつ一部は破壊的変更(マスターパスワード鍵移行・トークン上限UI・host/version 設定追加)を伴うため、以下の方針で実施:
- **即時修正(安全)**: OPFS WAL/BEGIN IMMEDIATE、PRIVACY_POLICY_VERSION バンプ、viewport meta 追加、HTML CSP `unsafe-inline` 削除、Logger onSuspend await、AGENTS.md パス修正、`conflictStats` 削除、i18n 重複/欠落修正。
- **要ユーザー判断(保留)**: マスターパスワード鍵ストレージ移行、トークン上限UI、Obsidian host/Gemini version 設定追加、中央 fetch 統合 — 別途確認後に実施。

---

## Phase 5 自動修正記録 (実施済み)

以下の安全な指摘をその場で修正。`npm run type-check` 通過 + 関連単体テスト 75件 成功で検証済み。

| 修正 | ファイル | 対応指摘 |
|------|----------|----------|
| OPFS init に `PRAGMA journal_mode=WAL` を追加 | `src/offscreen/opfsWorker.ts:91-93` | 🎯 WAL 欠落 (High) |
| `handleInsertBatch` を `BEGIN IMMEDIATE` に変更し、COMMIT 後 `SELECT changes()` で正確な件数取得 | `src/offscreen/opfsWorker.ts:356,369-372` | 🎯 BEGIN IMMEDIATE (High) |
| `PRIVACY_POLICY_VERSION` を `'2026-06-20'` にバンプ | `src/popup/privacyConsent.ts:11` | 🎯 再同意不整合 (High) |
| popup/options HTML に viewport meta 追加 + `style-src 'unsafe-inline'` 削除 | `entrypoints/popup/index.html`, `entrypoints/options/index.html` | 🎯 viewport 欠落 (High) / 🎯 CSP unsafe-inline (Medium) |
| `onSuspend` の flush を timeout 付き await (fire-and-forget 解消) | `src/utils/logger.ts:245-251` | 🎯 Logger setTimeout (High) |
| AGENTS.md: `npm build`→`npm run build`、Dashboard パスを `entrypoints/options/` 実態に修正 | `AGENTS.md:40,71-73` | 🎯 ドキュメント乖離 (Medium) |
| `confirmImport` 重複解消 (title を `confirmImportTitle` にリネーム + HTML 更新) | `public/_locales/{ja,en}/messages.json`, `entrypoints/{popup,options}/index.html` | 🎯 i18n 重複 (Medium) |
| `triggerTabClose` / `triggerTabCloseDesc` を en に追加 | `public/_locales/en/messages.json` | i18n 欠落 (Medium) |

**保留(要ユーザー判断)**: マスターパスワード鍵ストレージ移行、トークン月次ハードリミットUI、Obsidian host / Gemini version 設定追加、ObsidianClient 中央 fetch 統合、gistSyncTarget 未同期フィルタ、`conflictStats` 削除(テスト3件の書き換えが必要)、API レスポンススキーマ検証 — 上記は破壊的変更または設計判断が必要なため、確認後に別途実施。
