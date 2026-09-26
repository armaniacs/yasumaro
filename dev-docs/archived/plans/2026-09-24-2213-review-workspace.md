# Checking Team レビュー報告 — ワークスペース全量（main HEAD）

- 実行日: 2026-09-24
- 対象: ワークスペース全体（差分レビューではなく全量レビュー。3,235ファイル、HEAD `02e74628` = main、v6.9.23 相当。ブランチ `0924b` は main と完全一致）
- 実行方式: 並列（Wave 1: コア5観点 → Wave 2: スペシャリスト4クラスタ・16観点 → Wave 3: Test Experts）
- graphify: 利用可能（28,162ノード。各観点はコード読解前に god node・コミュニティ構造を参照）
- run-id: `main-20260924-203918`

## 総合評価: 88/100 (ランク: A)

観点別スコア（実行21観点の単純平均 87.6 → 88。Edge & Mobile のみ対象外で除外）:

| 観点 | スコア | | 観点 | スコア |
|------|-------:|-|------|-------:|
| Red Team Leader | 90 | | Compliance & Privacy Guard | 75 |
| Blue Team Leader | 90 | | Ethics & Bias Auditor | 95 |
| System Architect | 90 | | Supply Chain & Dependency Sentinel | 95 |
| Maintainability Guardian | 90 | | API & Contract Negotiator | 90 |
| Legacy Bridge Architect | 95 | | Domain Logic Expert | 95 |
| UI Expert | 90 | | Data Integrity Expert | 90 |
| Accessibility Advocate | 70 | | Refactoring Evangelist | 95 |
| i18n Expert | 70 | | DX Advocate | 90 |
| Documentation Architect | 90 | | Test Experts | 70 |
| Tuning Expert | 90 | | | |
| SRE/Ops Specialist | 85 | | | |
| FinOps Consultant | 95 | | | |

前回全量レビュー（2026-09-19）は 82/100 だったため +5.6 改善。

## 重要指摘事項（優先度順）

### [High] インタラクティブな SVG グラフがポインタ専用で、アクセシブルな名前も無い — **修正済み（Wave 3）**
- 指摘者: Accessibility Advocate（Test Experts が対処・テスト追加）
- 場所: src/dashboard/tagClusterLayout.ts:148 / entrypoints/options/index.html:1759, 2085, 2097
- 影響: 「ノードをクリックして履歴をフィルタ」がグラフの主要インタラクションなのにキーボードで到達・操作不可（WCAG 2.1.1 Level A 違反）。tagClusterSvg/比較 SVG は名前無しグラフィックで WCAG 1.1.1 未達。docs/ACCESSIBILITY.md の主張と実装が矛盾
- 対処: 共有ヘルパー `src/dashboard/graphNodeA11y.ts`（tabindex/role/aria-label + Enter/Space）を新設し3パネルに適用、SVG に `role="img"` + aria-label 追加。14件の新規テスト + 回帰100件 PASS、`tsc --noEmit` エラーなし

### [High] 🎯 options の data-i18n 必須規約に反するハードコードセクションが残存
- 指摘者: i18n Expert
- 場所: entrypoints/options/index.html:1263-1281（"Per-site Overrides" 全文英語ハードコード）、:1283-1288（"Cleansing Feedback" 英語 h3 + 日本語 help 混在）
- 影響: 全ユーザー表示テキストに data-i18n 必須というプロジェクト規約に反し、ja ユーザーに英語・en ユーザーに日本語が混在表示される。静的チェック（check-i18n.mjs）は属性持ちリテラルしか走査しないため検知不能の構造的盲点
- 対処: en/ja 両 messages.json にキー追加して data-i18n を適用。混在 help も同様

### [High] 🎯 PRIVACY.md 日本語版の暗号化キー保存先の記述が実装と矛盾（英語版のみ正しい）
- 指摘者: Compliance & Privacy Guard
- 場所: public/PRIVACY.md:145（docs/PRIVACY.md 同一箇所）vs src/utils/storage/encryptionSession.ts:154
- 影響: 日本語版は暗号化キーの保存先を誤って記載しており、プライバシーポリシーの法的・信頼上の正確性を損なう
- 対処: ja 版 L145 を英語版と同じ「chrome.storage.local に平文で保持され、拡張機能内アクセスは防げない」記述に修正し、PRIVACY.md と実装を突き合わせるリリースチェックを release:check に追加

### [Medium] 🎯 Obsidian REST API のエラーレスポンスボディを生のままログへ連結 — **修正済み（Wave 3）**
- 指摘者: Red Team Leader
- 場所: src/background/obsidianClient.ts:171, 203
- 影響: サーバ制御の最大1MBボディがログストレージ（unlimitedStorage）に膨張し、TSV エクスポート破壊・PII 二次漏洩の面に
- 対処: `src/utils/logTruncate.ts`（500文字 cap + 改行1行化）を新設し2箇所に適用。テスト検証済み

### [Medium] 🎯 非ローカル AI プロバイダスロットで http://localhost への平文資格情報送信が自己認可される
- 指摘者: Red Team Leader
- 場所: src/utils/storage/providerAllowlist.ts:332, 393-395
- 影響: 非ローカルスロットで loopback ホストが pinning/confirmed 判定を経由せず `'local'` として無条件認可され、平文 HTTP への API キー送信が正当化される
- 対処: loopback 短絡を isLocal 行（lm-studio/ollama/built-in）に限定し、非ローカルスロットの http は confirmed origins の明示確認を必須化

### [Medium] 🎯 マスターパスワード未設定時に鍵素材 ENCRYPTION_SECRET が平文で暗号文の隣に保存されている
- 指摘者: Blue Team Leader
- 場所: src/utils/storage/encryptionSession.ts:136-149, 166-198
- 影響: 暗号化の前提が実質無効化され、`chrome.storage.local` 単独アクセスで API キー群が復号可能になる
- 対処: saveDurableWrappingKey/loadDurableWrappingKey（IndexedDB non-extractable CryptoKey）を KEK に再利用し local にはラップ形のみ残す（hmacKeyStore.ts の候補チェーンと同型）

### [Medium] 🎯 removeMasterPassword() が既存の暗号化済み API キーを恒久的に復号不能にする（潜伏データロス）
- 指摘者: Blue Team Leader
- 場所: src/utils/storage/encryptionSession.ts:398-409
- 影響: マスターパスワード削除が既存の暗号化済み API キーをユーザー不知で破壊する
- 対処: 削除前に全 API_KEY_FIELDS を旧 KEK で復号 → 匿名 secret 系 KEK で再暗号化してから storage 更新。コストが高い場合は未再暗号化検知ガードを入れる

### [Medium] 🎯 RETRY ステップの失敗がオフラインジョブと pending page の二重回収経路に同時登録される（相互排除なし）
- 指摘者: Domain Logic Expert
- 場所: src/background/pipeline/stepExecutor.ts:53-55 + recordingOutcome.ts:138-157
- 影響: 同一失敗が2経路で二重回収され、二重実行リスクが生じる
- 対処: オフラインジョブ enqueue 成功のステップ失敗では pending page 登録をスキップ（または pending 側に jobKind を持たせ相互排除）。回収経路の優先順位を pin するテストを追加

### [Medium] 🎯 トランスポートのタイムアウト後 single retry が非冪等 mutate を二重実行しうる
- 指摘者: Data Integrity Expert
- 場所: src/background/OffscreenTransportBase.ts:49-81、src/background/sqlite/offscreenGateway.ts:107-119
- 影響: タイムアウト後に再送し、トグル系操作が二重適用される
- 対処: toggleStar 等のトグル系に noRetry を付与するか、冪等キーを導入。wire table に「再実行安全/不安全」フラグを置き archive と通常 mutate の基準を揃える

### [Medium] 🎯 withLock の CAS がオブジェクト値を比較せず、updateFn 再実行の冪等性が暗黙前提
- 指摘者: Data Integrity Expert
- 場所: src/utils/storage/storageTransaction.ts:256, 125-150
- 影響: オブジェクト値の競合検知がスキップされ、非冪等 updateFn は silent conflict を起こす
- 対処: (a) CAS を canonical deep-equal に統一、または (b)「updateFn は純粋かつ冪等」を JSDoc + テストで pin。バージョン未同時更新の直接 set を禁区とするルールを StorageTransaction 側にも置く

### [Medium] 🎯 sqliteAlert の連続失敗カウンタとクールダウンが SW 再起動で消失する
- 指摘者: SRE/Ops Specialist
- 場所: src/background/sqliteAlert.ts:21-23
- 影響: SW のエフェメラル性（モジュール状態保持禁止の規約違反）によりアラートが再起動ごとにリセットされる
- 対処: chrome.storage.session（SessionStore）へ consecutiveFailures / lastAlertTime を永続化

### [Medium] 🎯 プロバイダ既定 URL が 4 箇所に重複し、LM Studio では host 表記が分岐している
- 指摘者: Maintainability Guardian
- 場所: src/utils/storage/defaults.ts:52、src/background/ai/providerCatalog.ts:167,181、src/dashboard/panels/staticForm/generalSettingsPanel.ts:301,312、src/background/handlers/lifecycleHandlers.ts:23
- 影響: 既定 URL の修正漏れ・表記分岐が起きやすい（既に LM Studio で分岐発生中）
- 対処: 既定 URL を utils 側の単一テーブルに集約し、catalog 行・defaults・プリセットボタン・フォールバックをすべてそこから導出

### [Medium] 🎯 DENIED_DOMAINS / PERMISSION_NOTIFY_THRESHOLD が「settings オブジェクト契約」と「散在キー直書き」の二重管理
- 指摘者: Legacy Bridge Architect
- 場所: src/utils/permissionManager.ts:85-93, 289-291、src/dashboard/settings/trustSettings.ts:569、src/utils/storage/defaults.ts:108-109、src/utils/storage/restorableSettings.ts:62
- 影響: 2経路の書き込みが diverge しうる（storage キー構造は本プロジェクトの高リスク領域）
- 対処: 読み書きを SettingsRepository（typed get/set）に統一。散在運用に寄せる場合は内部キーとしてテストで二重管理を構造的に検出

### [Medium] 🎯 大量 DOM 操作向け規約（rAF バッチ + scheduler.yield）が本番ホットパスに未適用
- 指摘者: Tuning Expert
- 場所: src/content/contentKernel.ts:99、src/utils/contentExtractor/index.ts:221-276、src/content/cleansingOffscreenDelegate.ts:15
- 影響: cloneNode/TreeWalker 経路がメインスレッドを占有しうる。規約（AGENTS.md）が PoC のまま放置
- 対処: extractor 経路へ scheduler.yield() 導入 or cleanseViaOffscreen の default-on 移行を再評価。e2e longtask 数を bench:check のゲート対象に追加

### [Medium] ダッシュボードのパネル取得が毎回 status + query の 2 往復 IPC になる
- 指摘者: Tuning Expert
- 場所: src/dashboard/panels/fetchPeriodRows.ts:48-59、src/dashboard/dashboardSqliteService.ts:264-268
- 影響: 全パネル描画で無駄な往復が発生
- 対処: getSqliteStatus に短命 TTL キャッシュ（1〜5秒）を付けるか、query レスポンスへ status/initialized を同梱して1往復に削減

### [Medium] 🎯 PERFORMANCE_GUIDE が定める bench:check の CI ゲートが実際には未接線
- 指摘者: SRE/Ops Specialist
- 場所: dev-docs/PERFORMANCE_GUIDE.md:39-42、bench/README.md:24、.github/workflows/（bench 言及なし）
- 影響: パフォーマンス回帰ゲートが文書上のみで実効していない
- 対処: ci.yml に paths フィルタ付きの `npm run bench:check` ステップを追加（ゲート対象は決定論的カウンタのため安定）

### [Medium] ci.yml の node_modules キャッシュが npm ci と矛盾して純粋な無駄
- 指摘者: SRE/Ops Specialist（DX Advocate が同指摘 — 重複）
- 場所: .github/workflows/ci.yml:23-32、180-189
- 影響: npm ci は node_modules を必ず削除再生成するため restore が全損。job あたり数十秒の無駄
- 対処: node_modules キャッシュを削除し setup-node の npm キャッシュに一本化

### [Medium] PR で 2 ワークフローが lint / type-check / unit test を重複実行している
- 指摘者: DX Advocate
- 場所: .github/workflows/ci.yml:45-54（validate job）と tests.yml:110-134（test job）
- 影響: PR ごとに type-check と 746ファイル規模の unit suite が2回走り、CI 時間とランナー課金の直接の無駄
- 対処: ci.yml の validate job を push(main) のみに限定するか、tests.yml から type-check/unit test を削除して ci.yml に集約（e2e のみ tests.yml に残す）

### [Medium] Playwright ブラウザのキャッシュが job によって使われ/使われない
- 指摘者: DX Advocate
- 場所: .github/workflows/tests.yml:88-95（キャッシュあり）vs :28-29, 56-57（a11y/usability はキャッシュなしで毎回 install）
- 影響: a11y/usability の PR ごとにブラウザ DL + apt 依存導入が毎回発生（各1〜2分）
- 対処: a11y / usability job にも firefox-storage と同じ actions/cache ステップを追加

### [Medium] AI プロバイダーフォールバック連鎖にサーキットブレーカーがなく、壊れたプロバイダへの有料再送が止まらない
- 指摘者: FinOps Consultant
- 場所: src/background/ai/RemoteAIService.ts:152-186, 55（MAX_PROVIDERS=10）、src/background/pendingSqliteQueue.ts:35
- 影響: 10スロットを順に廻り、障害継続中も外部 AI API への無駄送信が続く
- 対処: プロバイダ×モデル単位の連続失敗カウンタを chrome.storage.session に永続化し、K 回連続失敗スロットを N 分間スキップ（rateLimiter.ts の flushImmediately パターン流用可）

### [Medium] 🎯 Content-SW プロトコルバージョンのハードコード複製 — **修正済み（Wave 3）**
- 指摘者: API & Contract Negotiator（Test Experts が対処）
- 場所: wxt.config.ts:100（`JSON.stringify(1)`）vs src/messaging/protocol.ts:20
- 影響: protocol bump 時に片側だけ上がるドリフトがコメント頼みだった
- 対処: wxt.config.ts が `CURRENT_PROTOCOL_VERSION` を import して導出。protocol-ssot テスト新設 + protocol-sync.test.ts 更新、検証全 PASS

### [Medium] 🎯 Obsidian Local REST API クライアントが単発 fetch でリトライしない
- 指摘者: API & Contract Negotiator
- 場所: src/background/obsidianClient.ts:240（testConnection）、src/utils/obsidianConfigBuilder.ts:88-95
- 影響: 一時的な network/5xx で同期・接続検証が即失敗する（AGENTS.md の「エラーハンドリングとリトライ必須」に不十分）
- 対処: 書き込み結果に操作 ID を持たせ 409/一意制約を冪等成功とみなす等の冪等性設計の上、connection reset / 5xx / timeout に限定した指数バックオフ再試行を導入

### [Medium] 🎯 Tranco リスト偏りが「記録可否」判断に直接写像される
- 指摘者: Ethics & Bias Auditor
- 場所: src/background/pipeline/steps/checkTrustDomainStep.ts:23-34、src/utils/trustChecker.ts:196
- 影響: Top 1000/10k は英語圏・大手中心で、リスト外の地域的・規模的小サイトが「信頼できない = 記録ブロック」として継続的に不利を受ける
- 対処: 「記録するが信頼マークを付けない」等のデグレード挙動を追加、または既訪問ドメインの一括許可オンボーディングを提示

### [Medium] 🎯 package-lock.json の resolved が標準レジストリではなく npm.flatt.tech ミラーに固定（全839件）
- 指摘者: Supply Chain & Dependency Sentinel
- 場所: package-lock.json（resolved エントリ全件、例: node_modules/wa-sqlite）
- 影響: 他環境・CI がミラーに暗黙依存。ミラー障害でインストール全断、サプライチェーンの単一障害点
- 対処: CI 側に registry.npmjs.org を明示設定、または lockfile を標準レジストリ向きで再生成。意図的にミラーを使うなら .npmrc で根拠を明示

### [Medium] 🎯 data-i18n SSOT を迂回する生フォールバック `getMessage(...) || '日本語'` が約60箇所残存
- 指摘者: i18n Expert
- 場所: src/dashboard/domainFilterTagUI.ts:64-68, 91, 110, 115 / generalSettings/connectionTests.ts（15件）/ trancoConsent.ts（7件）/ panels/asyncData/sqliteHistoryPanelView.ts（14件）/ src/popup/statusPanel.ts:421, 423 — 計12ファイル以上
- 影響: フォールバックヘルパー getMessageOr に SSOT 化済みなのに旧パターンが残存。キー削除・リネーム時に en ユーザーへ日本語が静かに表示。domainFilterTagUI.ts:91 の aria-label は常時日本語テンプレートで en 読み上げも日本語になる
- 対処: `getMessageOr(key, fallback)` への機械的置換。aria-label は `{domain}` プレースホルダー付きキー新設

### [Medium] プリセットプロンプト本文がソースコード埋め込みでロケール非対応
- 指摘者: i18n Expert
- 場所: src/utils/customPromptUtils.ts:123-166（PRESET_PROMPTS 日本語固定）、:189-190（getPromptDisplayName が locale 分岐）
- 影響: en ロケールでプリセットを選ぶと AI へ送られる指示文が日本語のまま（要約出力も日本語前提）
- 対処: プリセット名を messages.json 化、本文は ja/en バリアントをロケールで選択

### [Medium] 🎯 options の `role="tabpanel"` 全パネルにアクセシブルな名前が無い
- 指摘者: Accessibility Advocate
- 場所: entrypoints/options/index.html（例: 1661, 1748, 1833, 1924 等の全 section[role=tabpanel]）
- 影響: スクリーンリーダーが「パネル」としか読み上げず設定ページ名が不明
- 対処: 各 h2 に id を付与し aria-labelledby で参照

### [Medium] dialog のラベル付けが不統一
- 指摘者: Accessibility Advocate
- 場所: entrypoints/popup/index.html:239（#private-page-dialog）、:256（#recording-failed-dialog）
- 影響: ダイログ開始時に見出しが読まれず文脈無しで聞こえる（:212, :271 の modal は指定済みでパターンは存在）
- 対処: aria-labelledby を追加（見出し id は既存）

### [Medium] 🎯 未定義のボタンクラスにより破壊的操作ボタンが無スタイルで表示される
- 指摘者: UI Expert
- 場所: entrypoints/options/index.html:1587, 1599, 1867（btn-danger）、1864-1868, 1880-1882, 2316（btn btn-secondary）
- 影響: `.btn-danger` は全 CSS に未定義。Delete All Data / Withdraw Consent 等の破壊的操作がブラウザデフォルトの素の見た目になり、誤タップや重要度の見誤りを招く
- 対処: 既存 `btn-primary`/`secondary-btn` 体系へ統一、または tokens.css に `.btn-danger`/`.btn-secondary` を正式定義（2命名体系の混在が根因）

### [Medium] 分析パネル群の SVG グラフが固定サイズでリフローしない
- 指摘者: UI Expert
- 場所: entrypoints/options/index.html:1759（#tagClusterSvg 800×600）、2085/2097（tagCompare 480×420）
- 影響: docs/ACCESSIBILITY.md が「400%ズーム時もリフロー」を AA 達成項目として掲げるが、新規分析パネルは width/height 固定で高ズーム時に横スクロール発生
- 対処: viewBox を設定し CSS で `width: 100%; max-width: 800px` 等にする

### [Medium] 🎯 i18n-guide.md のキー数記載が実態と不一致（1290 vs 実勢1455）
- 指摘者: Documentation Architect
- 場所: docs/i18n-guide.md:17-18, 317-318（「✅ 100% (1290キー)」）
- 影響: 「ドキュメントは最新仕様のスナップショットのみ」という規約に反する陳腐化。同期チェック対象外
- 対処: キー数をハードコードせず「en/ja 完全同期」の状態表現にする（または CI で生成）

### [Medium] README の日英内容分岐（UI 説明・プリセット数）
- 指摘者: Documentation Architect
- 場所: README.md:90（日本語「⚙アイコンから専用ダッシュボードへ」）vs :321（英語 "easy hamburger menu access"）。:96, :327 の「5種類のプリセット」が列挙4種（実装は Default 含め5種）
- 影響: 同じ機能の操作手順が言語で異なりユーザーが迷う
- 対処: ⚙ 表記に日英統一。プリセット列挙を5種に修正

### [Medium] 🎯 PRIVACY_POLICY_VERSION ('2026-07-31') が PRIVACY.md 最終更新日 (2026-09-08) に未追随
- 指摘者: Compliance & Privacy Guard
- 場所: src/utils/storage/privacyConsent.ts:16 vs public/PRIVACY.md:3
- 影響: 同意バージョン管理がポリシー改定と乖離し、再同意判定の根拠が実態と一致しない
- 対処: PRIVACY_POLICY_VERSION を '2026-09-08' に更新し、定数と PRIVACY.md 最終更新日の一致を scripts/release-checks で検証

### [Medium] 💎 記録優先順位の散文コメントが 3 ファイルで重複し、注釈が drift しうる
- 指摘者: Refactoring Evangelist
- 場所: src/utils/recordingGateTable.ts:1-6、src/background/pipeline/recordingDecision.ts:11-15、src/background/pipeline/RecordingOrchestrator.ts:92-97
- 影響: 最重要不変条件（domainFilter → permission → trust → privacyHeaders → duplicate の順序）の説明が3箇所に散在し、順序変更時にコメントが嘘をつく
- 対処: canonical 説明を recordingGateTable.ts のみに置き、他2箇所は SSOT 参照の1行リンクに縮約

### [Low] 主要な残り指摘（16件・スコア影響なし）
- setElementHtml の `<script>` 削除のみの防御層が過剰な安全確認を誘発（Red Team）— htmlFragment.ts:72
- SSRF ガードが DNS 解決結果を検査しない（リバインディング残存）（Blue Team）— ssrfGuard.ts（SW に DNS API がなく完全解消困難、脅威モデル受容として明記方向）
- messaging → background の逆依存（System Architect）— src/messaging/types.ts（実害ゼロ・ADR 記録済み）
- dashboard 内に formatBytes の独立実装が2つ（Maintainability）— cleansingStatsView.ts / entryByteDelta.ts
- migrateToSingleSettingsObject の完了フラグ先書きと `_version` 部分一致ヒューリスティック（Legacy Bridge）— settingsMigration.ts:58
- trustChecker の SAFETY_MODE / TRANCO_TIER レガシー散在パスがデッドコード残存（Legacy Bridge）— trustChecker.ts:182-212
- トークン経由外ハードコードと未翻訳 tooltip（UI）— popup/index.html:186, 39
- ドキュメント総覧に ACCESSIBILITY.md / i18n-guide.md 未掲載（Documentation）— README.md:497-555, docs/guides.html
- ci.yml に paths フィルタがなく docs-only 変更でも全ジョブが走る（FinOps）— ci.yml:3-7
- 同意拒否後の再同意 UI の操作負荷非対称（Ethics）— PRIVACY.md:135
- wasm ship バイナリの再現性検証は gate 依存（Supply Chain）— 現状で許容と判定
- オフライン enqueue 判定がエラーメッセージ部分文字列依存（Domain Logic）— retryPolicy.ts:16-37
- pendingSqliteQueue の失敗がバッチ粒度で毒レコードが健全レコードを道連れ（Data Integrity）— pendingSqliteQueue.ts:80-92
- previewOnly の二重検出と cast ハック（Refactoring）— RecordingOrchestrator.ts:136, 144
- 非推奨エイリアス・互換 shim の解約日未定（Refactoring）— check-deprecated-aliases.mjs
- ci.yml の node_modules キャッシュ効果なし（DX — SRE Medium と同一対象）

## コンフリクト調整結果

System Architect による対立指摘の調整見解（🔗 4件）:

1. **セキュリティ vs 保守性** → セキュリティ優先を支持。PII マスキング・SSRF guard・CSP・暗号化が utils 層に構造的に配置され静的強制まである。保守性のためにサニタイズを省ける余地は設計レベルで塞ぐこと（Red Team の setElementHtml Low 指摘もこの見解に従い防御縮小は推奨しない）
2. **パフォーマンス vs 保守性** → 「計測値提示が前提のボトルネックのみ最適化」（wasm ハイブリッドの型）に寄せる。Tuning の rAF/yield 指摘も計測（longtask ベンチ）を伴うものとして扱う
3. **抽象化 vs 単純性** → wire table / compositionManifest / 独自 lint は fail-closed 利点が複雑性を上回る。抽象の枚数が増えた時点が統合判断点で、先回りの全面統一はしない
4. **構造整理（utils 再編・Gateway 分割）vs 変更リスク** → 保護機構（LAYERS.md/lint/ADR）が整った今が着手適期。ただし大量 import 替えはバグ修正系観点と衝突しやすいため、rename 系と機能系の並行は避けて配分すること

## コードベース構造の知見（graphify）

- god nodes は `errorMessage()` (304 edges) / `getMessage()` (232) / `addLog()` (202) / `StorageKeys` (195) / `logError()` (140) / `Settings` (119) / `SettingsRepository` (111)。いずれもレイヤー最底辺の横断関心であり、System Architect は「依存集中は集約の成果で責務混入ではない」と判定。**全21観点いずれも god node のシグネチャ変更を要求する指摘はゼロ**で、影響範囲は限定的
- 層構造（background / popup / dashboard / offscreen / content / utils）は eslint の `local/utils-layer-boundary`・SettingsRepository 単例強制・composition root（compositionManifest 274行）で機械強制されており、例外循環3件は dynamic import + ADR で管理済み。指摘の大半はこの層内部の実装品質に集中し、層間境界の破の破壊は検出されなかった
- ナレッジグラフ上のアーキテクチャ分析記事（4本の脊椎・2つの島）と archived PBI 群が指摘と一致: OffscreenGateway の archive 集積・utils フラット namespace は過去 PBI として記録済みで、今回の System Architect 指摘は「未着手のまま残っている既知負債」を再確認するもの
- SQLite offscreen 分離（wire table + fail-closed drift 検出）と Rust/WASM ハイブリッド（ベンチ→閾値→TS フォールバック）は graphify の依存パス上でも background を介さない独立コミュニティとして機能しており、Data Integrity / Tuning の指摘はいずれもこの seam の内側に留まっている
- 新規分析パネル群（heatmap / word cluster / tag co-occurrence）は dashboard コミュニティ内に新規サブグラフを形成済みで、今回の Accessibility・UI 指摘は全てこの新規サブグラフ（旧パネルには既に対応済みパターンがある）に集中している

## 対象外としてスキップした観点

Edge & Mobile Strategist（モバイル/PWA/レスポンシブ対応コードが存在しないため）

## 未完了の観点

なし

---

## 修正状況（Phase 5 実施後）

`npm run validate`（type-check + 全テスト）green: 896ファイル / 13,862テスト PASS、lint エラー0。

### 修正済み（計23指摘）

- **High 3件すべて修正済み**
  - SVG グラフのキーボード操作・アクセシブル名（Wave 3 Test Experts — `graphNodeA11y.ts` 新設 + 14テスト）
  - options の data-i18n 違反ハードコード（9キー追加、en/ja 同期）
  - PRIVACY.md 日本語版の暗号化キー記述（英語版と同一化。`diff public/PRIVACY.md docs/PRIVACY.md` 空を確認）
- **Medium 19件修正済み**
  - Frontend: tabpanel aria（25件）/ dialog aria（2件）/ btn-danger・btn-secondary 定義（dashboard.css）/ SVG viewBox+リフロー / getMessage→getMessageOr・getMessageWithSubstitutions 置換 332件（41ファイル）
  - Docs/Privacy: PRIVACY_POLICY_VERSION → '2026-09-08' + `scripts/release-checks/check-privacy.mjs` 新設（2ファイル同期+日付一致を gate 化）/ i18n-guide キー数除去 / README 日英統一
  - CI: node_modules キャッシュ削除 / `bench:check` job 新設（paths フィルタ付き）/ tests.yml の type-check・unit test 重複削除（PR 上で各チェック1回以上の網羅を維持）/ Playwright キャッシュを a11y・usability に統一
  - Src: sqliteAlert を chrome.storage.session 永続化 / プロバイダ既定 URL を `providerDefaultBaseUrls.ts` に SSOT 化（LM Studio 表記を 127.0.0.1 に統一）/ 記録優先順位コメントを recordingGateTable に集約 / providerAllowlist の localhost 自己認可を isLocal 行に限定 / withLock の冪等契約を JSDoc+テストで pin（選択肢b）/ toggleStar に noRetry 適用
  - 連動修正: `testDir/e2e/recording-traceId.spec.ts` の PRIVACY_POLICY_VERSION ミラー定数を同期
- Obsidian ログ切り詰め（`logTruncate.ts`）と protocol バージョン導出化は Wave 3 で修正済み（上記 Medium 計上に含む）

### 確認待ち（15 Medium — 破壊的変更・設計判断を伴うためユーザー確認を保留）

| 指摘 | 観点 | 確認が必要な理由 |
|------|------|------------------|
| ENCRYPTION_SECRET のラップ形保存 | Blue Team | 暗号設計の変更（IndexedDB KEK 移行） |
| removeMasterPassword の再暗号化 | Blue Team | 暗号設計 + 既存データ移行 |
| utils フラット namespace の再編 | System Architect | 大量 import 替え。専用ブランチ推奨（ADR 記録済み） |
| OffscreenGateway の archive 分割 | System Architect | 構造変更（ArchiveGateway 抽出） |
| popup/errorUtils の providerCatalog 依存 | Maintainability | モジュール分割という構造変更 |
| DENIED_DOMAINS 等の二重管理統一 | Legacy Bridge | storage キー構造は高リスク領域 |
| プリセットプロンプトのロケール対応 | i18n | AI への指示文コピーの製品判断 |
| rAF/scheduler.yield のホットパス適用 | Tuning | 計測（longtask ベンチ）前提の性能変更 |
| status+query の IPC 1往復化 | Tuning | メッセージ契約の変更 |
| AI プロバイダのサーキットブレーカー | FinOps | 新機能（失敗カウンタ設計） |
| ObsidianClient の冪等リトライ | API & Contract | 冪等キー設計（重複書き込みリスク） |
| Tranco 偏りのデグレード挙動 | Ethics | 記録ブロック挙動の製品判断 |
| package-lock のミラー固定解除 | Supply Chain | lockfile 再生成（再現性・レジストリ判断） |
| RETRY の二重回収経路の相互排除 | Domain Logic | 回収経路の優先順位という設計判断 |
| トランスポート冪等キー導入 / CAS deep-equal 化 | Data Integrity | toggleStar noRetry と冪等 pin は対処済み。残りは設計判断 |

Low 16件はスコア非影響のため未対応（内容は上記「[Low]」節を参照）。
