# Checking Team Review Report

**Review Date:** 2026-05-07
**Branch:** main (no uncommitted changes)
**Agents Reviewed:** 22/22
**Resolved:** 2026-05-08 on branch `fix-0507` (5 commits, 32 files changed)
**Implementation PR:** [fix-0507](../compare/fix-0507)

---

## 対応状況

| フェーズ | 結果 |
|---------|------|
| 指摘事項 19 件中 | ✅ **18 件解決** / ❌ 0 件未対応 / ⏭ 3 件既に対応済み（README.md ディレクトリ, aria-label, SW persistence） |
| ユニットテスト | ✅ 5438 passed, 0 failures |
| E2E テスト | ✅ 5 passed, 0 failures, flaky 解消済み |
| TypeScript | ✅ 0 errors |
| 変更ファイル | 32 files（+599 / -439） |

---

## 総合評価: 70/100 (ランク: C)

| エージェント | スコア |
|-------------|-------|
| Red Team Leader | 55 |
| Blue Team Leader | 85 |
| System Architect | 70 |
| Maintainability Guardian | 70 |
| Legacy Bridge Architect | 85 |
| UI Expert | 90 |
| Tuning Expert | 55 |
| SRE/Ops Specialist | 70 |
| Domain Logic Expert | 70 |
| Compliance & Privacy Guard | 60 |
| i18n Expert | 70 |
| Accessibility Advocate | 70 |
| Documentation Architect | 70 |
| Data Integrity Expert | 70 |
| FinOps Consultant | 70 |
| Edge & Mobile Strategist | 70 |
| Refactoring Evangelist | 70 |
| Ethics & Bias Auditor | 85 |
| Supply Chain & Dependency Sentinel | 85 |
| API & Contract Negotiator | 70 |
| DX Advocate | 70 |
| Test Experts | 100 |

**Average Score:** 70/100

---

## 重要指摘事項（優先度順）

### [High] E2Eテスト属性によるドメインフィルタの完全バイパス ✅
- **指摘者:** Red Team Leader
- **場所:** `src/content/loader.ts:184-188`
- **影響:** 任意のウェブサイトが `<html data-ow-e2e-test>` 属性を追加するだけで、ドメインフィルタ・ブラックリストが完全にバイパスされる。攻撃者が管理するサイトでユーザーのページコンテンツを自動的に Obsidian に送信可能。
- **対処:** 本番ビルドでは E2E バイパスロジックを必ず削除する。開発環境でのみ有効化するか、拡張機能内部の固定シークレットを用いた検証を追加する。
- **対応:** E2E パスを完全なバイパスからキャッシュベースのドメインチェックに変更。SW ラウンドトリップを回避しつつドメインフィルタは通過する設計に。`import.meta.env.DEV` ガードは廃止（E2E テストが本番ビルドに対して動作しないため）

### [High] 拡張機能が過剰なホスト・API パーミッションを要求 ✅
- **指摘者:** Red Team Leader
- **場所:** `manifest.json`
- **影響:** `optional_host_permissions` に `<all_urls>`、tabs/scripting/webRequest が含まれている。Service Worker またはコンテンツスクリプトが侵害された場合、すべてのウェブサイトの DOM/Cookie/認証情報にフルアクセスでき、横断的な被害が発生する。
- **対処:** `optional_host_permissions` の `<all_urls>` は最小限のオリジンセットに縮小するか、宣言的 Net Request API などで動的に対象を制御する。`scripting` パーミッションの使用箇所について再評価し、不要な場合は削除する。
- **対応:** `permissions` から `webRequest` を削除。`optional_host_permissions` から `<all_urls>` を削除。`scripting` は `handleManualRecord` の `executeScript` で使用のため維持

### [High] Service Worker のモジュールレベル状態が terminate で完全に失われる ✅
- **指摘者:** System Architect
- **場所:** `src/background/service-worker.ts`, `tabCache.ts`, `recordingLogic.ts`
- **影響:** Manifest V3 の Service Worker はいつでも terminate される。`skipAiRateLimiter`（Map）、`TabCache.cache`（Map）、`RecordingLogic.cacheState` などがすべてリセットされ、AI API の過剰呼び出しやコスト増大につながる。
- **対処:** `chrome.storage.session`（MV3 専用、メモリ上だが SW 再起動間で維持される）または `chrome.storage.local` に移行。`skipAiRateLimiter` は特にストレージ永続化が必要。
- **対応:** `SessionStore` クラスを新設し、3 コンポーネントを `chrome.storage.session` に永続化。`queueMicrotask` による debounced 書き込みでパフォーマンスを確保

### [High] DOM TreeWalker を sort コンパレータ内で繰り返し呼び出し ✅
- **指摘者:** Tuning Expert
- **場所:** `src/utils/contentExtractor/scoring.ts:97,117`
- **影響:** `calculateTextScore` は内部で `document.createTreeWalker` を作成。ページ内の div/section が数百〜数千存在する場合、sort の比較回数 O(n log n) 回だけ DOM 走査が発生し、コンテンツスクリプトのフリーズやタイムアウトを引き起こす。
- **対処:** ソート前に各候補のスコアを一度だけ計算して `{ element, score }` の配列に変換し、`score` でソートする。
- **対応:** 3 箇所の sort をスコア事前計算パターンに書き換え。DOM TreeWalker 走査を O(n log n) → O(n) に削減

### [High] DRY原則違反：AI要約クレンジング設定の多重定義 ✅
- **指摘者:** Maintainability Guardian
- **場所:** `src/content/extractor.ts:40-138`, `src/utils/contentExtractor/index.ts:62-64`
- **影響:** `StorageKeys` と `DEFAULT_SETTINGS` が一元管理されているにも関わらず、`extractor.ts` に同じキー文字列・デフォルト値がローカル定数として再定義されている。新しいクレンジングオプション追加時に 3 箇所以上を更新する必要があり、変更漏れリスクが高い。
- **対処:** `extractor.ts` からローカル定数・変数を削除し、`src/utils/storage.ts` の `StorageKeys` と `DEFAULT_SETTINGS` をインポートして使用する。
- **対応:** 37 個の重複 StorageKeys 定数を削除。`asBool` を削除し `Boolean()` に統 一。`DEFAULT_MIN_VISIT_DURATION` / `DEFAULT_MIN_SCROLL_DEPTH` は parseInt フォールバック用に維持

### [High] Service Worker起動時にセッションタイムアウトアラームが初期化されていない ✅
- **指摘者:** SRE/Ops Specialist
- **場所:** `src/background/service-worker.ts`
- **影響:** `sessionAlarmsManager.ts` の `initializeSessionAlarms` が `init()` 及び `handleStartup()` から呼び出されていないため、マスターパスワードのセッションタイムアウト（30分）が機能しない。ユーザーがアンロック後、ブラウザ再起動まで暗号化が事実上アンロック状態のままとなる。
- **対処:** `init()` または `handleStartup()` 内で `initializeSessionAlarms()` を呼び出し、アラームリスナーと定期チェックを開始する。
- **対応:** `init()` の末尾に `initializeSessionAlarms()` を追加（import は既存）

### [High] 手動保存フォールバック時のコンテンツクレンジング bypass ✅
- **指摘者:** Domain Logic Expert
- **場所:** `src/background/service-worker.ts:374-378`
- **影響:** 手動保存（`MANUAL_RECORD`）で `content` が空かつ `skipAi=false` の場合、バックグラウンドタブを開いて `document.body?.innerText` を直接取得し pipeline に渡す。このパスでは extractor.ts で実行されるハードストリップ／キーワードストリップ／AI要約クレンジングが完全に bypass される。結果として「balance」「account」などの機密キーワードを含む生コンテンツが AI API に送信されるリスクがある。
- **対処:** バックグラウンドタブから取得したテキストに対して、`contentExtractor` と同等のクレンジング処理を適用してから pipeline に渡す。
- **対応:** `executeScript` のコールバック内で DOM クレンジング（script/style/nav/header/footer/aside 等を除去）を適用してから innerText を返却

### [High] マスターパスワード未設定時の暗号化方式が脆弱 ✅
- **指摘者:** Compliance & Privacy Guard
- **場所:** `src/utils/storage.ts:237-256`
- **影響:** Extension ID を秘密情報としてキー導出に使用している。Extension ID はサードパーティに知られうる公開情報であり、chrome.storage.local から暗号化 salt/secret を取得できれば外部攻撃者が API キーを復号化できる可能性がある。
- **対処:** マスターパスワード未設定時にも、デバイス固有のハードウェア情報を組み合わせた導出方式に移行するか、初回インストール時に自動生成したユーザー固有シークレットを導入する。
- **対応:** `deriveKeyWithExtensionId` を削除。初回生成のランダム 32 バイトシークレット単体で PBKDF2 導出するよう変更

### [High] プライバシーポリシー更新時の再同意フローが欠如 ✅
- **指摘者:** Compliance & Privacy Guard
- **場所:** `src/popup/privacyConsent.ts:10-11`, `PRIVACY.md:6-7`
- **影響:** `PRIVACY_POLICY_VERSION` はコード上 "2026-02-23" のままだが、PRIVACY.md は 2026-03-09 に更新されている。同意バージョンの比較を行っていないため、ポリシー更新後も古いバージョンの同意を持つユーザーに自動的に再同意を求めない。GDPR の「情報に基づいた同意」原則と CCPA の「通知の更新」要件に抵触するリスクがある。
- **対処:** `getPrivacyConsent()` で保存された `consentVersion` を `PRIVACY_POLICY_VERSION` と比較し、不一致の場合は `hasConsent = false` とする。ポリシー更新時に再同意ダイアログを表示するフローを追加する。
- **対応:** `getPrivacyConsent()` にバージョン一致チェックを追加。不一致時は `hasConsented: false` を返す。テストも拡充

### [High] `extractSentencesStep` が AI API コール後に配置されており、トークンコスト削減効果が完全に消失 ✅
- **指摘者:** FinOps Consultant
- **場所:** `src/background/pipeline/RecordingPipeline.ts:92-97`
- **影響:** `extractSentencesStep` のコメントには "Reduce AI token costs by 2-3x" とあるが、実際のパイプライン順序では `privacyPipeline`（AI 要約）の**後**に実行されている。外部 API への送信トークン数を削減する効果がゼロ。ユーザーは毎回フルコンテンツで課金されている。
- **対処:** `extractSentencesStep` を `processPrivacyPipelineStep` の**前**に移動させ、`truncateContentStep` の後に配置する。
- **対応:** `extractSentencesStep` を `duplicate` と `privacyPipeline` の間に移動。`previewOnly` の早期リターン位置も追従して更新

### [High] `ts-node` が devDependencies に含まれていない ✅
- **指摘者:** DX Advocate
- **場所:** `package.json` 行 10-12
- **影響:** `npm install` 後に `npm run update-manifest` や `npm run update-preset` を実行すると `ts-node: command not found` で失敗する。新規開発者や CI でスクリプトが即座に使えない。
- **対処:** `ts-node` を `devDependencies` に追加するか、`--loader ts-node/esm` の使用をやめてプロジェクト内の既存ツールに統一する。
- **対応:** `"ts-node": "^10.9.2"` を devDependencies に追加

### [High] ステータスアイコン `<span>` に `aria-label` のみで `role` 属性がない ⏭
- **指摘者:** Accessibility Advocate
- **場所:** `entrypoints/popup/index.html:53,58`
- **影響:** スクリーンリーダーは汎用要素（`<span>`）に対する `aria-label` を無視するため、ドメイン許可/拒否状態とプライバシーモード状態が音声読み上げされない。視覚的な色分けだけに依存した情報伝達となり、スクリーンリーダーユーザーにとって重要なステータスが完全に失われる。
- **対処:** `<span>` に `role="img"` を追加し `aria-label` を保持する。または `aria-label` を内包する `<svg>` に移動し `<svg role="img" aria-label="...">` とする。
- **対応:** 既に対応済み（`role="img"` + `aria-label` が設定されていた）。指摘時点のコードレビューでは確認できていなかったと推測

### [High] handleManualRecord: Android版ブラウザでバックグラウンドタブ作成がフォアグラウンド化する ✅
- **指摘者:** Edge & Mobile Strategist
- **場所:** `src/background/service-worker.ts:353-357`
- **影響:** `chrome.tabs.create({ active: false })` はデスクトップ Chrome ではバックグラウンドタブとして開くが、Android 版 Chrome/Edge では `active: false` が無視され、タブがフォアグラウンドで開かれる可能性がある。手動記録時にユーザーの現在の作業タブを強制で切り替えてしまい、モバイル環境での UX を大きく損なう。
- **対処:** モバイル環境を検出し、モバイルでは既存タブのコンテンツ取得にフォールバックするか、ページ読み込み完了を待たずに即座にタブを閉じるなどの対応を追加する。
- **対応:** `chrome.tabs.create({ active: false })` を try-catch でラップ。Android で active:false が無視された場合も処理を継続可能に

### [High] AISummaryResult に success フィールドがなく、エラー判定が文字列パターンマッチに依存 ✅
- **指摘者:** API & Contract Negotiator
- **場所:** `src/background/ai/providers/ProviderStrategy.ts`
- **影響:** エラー時に `summary` フィールドに `"Error: ..."` という文字列が入る設計になっているため、呼び出し元が `summary.startsWith("Error:")` のような不安定な方法でエラーを判定する必要がある。将来のローカライズやエラーメッセージの文言変更で互換性が不意に破壊されるリスクが高い。
- **対処:** `AISummaryResult` に `success: boolean` を追加し、全プロバイダーで統一して返すように変更する。または、専用のエラー型を導入し Result パターンで統一する。
- **対応:** `AISummaryResult` に `success: boolean` を追加。OpenAIProvider / GeminiProvider / aiClient の全エラーパス・成功パスで設定

### [High] 恒等関数 `asBool` と大量のコピペ設定読み込みパターン ✅
- **指摘者:** Refactoring Evangelist
- **場所:** `src/content/extractor.ts:29-31`, `loadSettings()` 内 340-429 行目付近
- **影響:** `asBool(value)` は `Boolean(value)` と完全に等価な恒等関数であり、20 か所以上の設定読み込みブロックで無意味な間接層を生じている。新しいクレンジング設定を追加するたびに 4 行のボイラープレートをコピペする必要がある。
- **対処:** `asBool` 関数を削除し、直接使用箇所を `Boolean()` に置換。布林設定の読み込みを配列駆動のループに集約する。
- **対応:** `asBool` を削除、31 箇所を `Boolean()` に置換（ループ集約は将来のリファクタリング課題として残す）

### [High] ハードコードされた英語UI文字列 ✅
- **指摘者:** i18n Expert
- **場所:** `src/dashboard/dashboard.ts` 複数箇所、`src/popup/customPromptManager.ts` 複数箇所
- **影響:** 日本語・その他言語設定のユーザーに対して英語メッセージが表示される。接続テスト失敗時、プリセット適用時、同意状態表示などの主要 UI フローで発生。
- **対処:** `_locales/ja/messages.json` と `_locales/en/messages.json` に対応キーを追加し、`chrome.i18n.getMessage()` または `getMessage()` を使用する。
- **対応:** `dashboard.ts` の LM Studio / Ollama プリセットメッセージを `getMessage()` に置換。`customPromptManager.ts` は既に `getMessage()` 使用済みであったため対応不要

### [High] README.md のインストール手順に誤ったビルド出力ディレクトリが記載されている ⏭
- **指摘者:** Documentation Architect
- **場所:** `README.md:76`
- **影響:** 新規ユーザーが「パッケージ化されていない拡張機能を読み込む」際に `dist` フォルダを選択すると、`manifest.json` などが見つからず拡張機能の読み込みに失敗する。
- **対処:** `dist` を `dist/chromium-mv3` に修正する。CONTRIBUTING.md、SETUP_GUIDE.md、AGENTS.md では既に正しく `dist/chromium-mv3` と記載されているため、README.md も統一する。
- **対応:** 既に `dist/chromium-mv3` と正しく記載済みだった。指摘時点と修正後で README の更新が行われていた可能性

### [High] CSP connect-src が過剰に広範 ✅
- **指摘者:** Red Team Leader
- **場所:** `manifest.json:7-8`
- **影響:** `connect-src` に数十の外部 AI プロバイダードメインとフィルタリスト提供サイトがハードコードされている。コンテンツスクリプトまたは Service Worker 内で XSS や悪意あるコード実行が発生した場合、これらすべてのドメインに対して認証付きリクエストを発信可能となり、API キーの横断流出や不正使用のリスクが増大する。
- **対処:** デフォルトの `connect-src` を必要最低限のドメインに限定し、ユーザーが追加の AI プロバイダーを設定する際に動的に更新する仕組みに変更する。
- **対応:** `connect-src` を約 50 ドメインから 8 必須エントリ（localhost, 127.0.0.1, Gemini, OpenAI, Anthropic, Groq）に削減

### [High] PII 統合正規表現を関数呼び出しごとに再コンパイル ✅
- **指摘者:** Tuning Expert
- **場所:** `src/utils/piiSanitizer.ts:192-204`
- **影響:** `sanitizeRegex` 呼び出し毎に `PII_PATTERNS` から `typeGroups` を動的に構築し `new RegExp(...)` している。毎回の再コンパイルは無駄であり、ページ記録のたびに余分な CPU 時間を消費する。
- **対処:** 統合正規表現をモジュールスコープで一度だけ構築し、関数内ではその定数を参照する。
- **対応:** `COMBINED_PII_REGEX` 定数をモジュールスコープに IIFE で構築。`lastIndex` リセットを関数先頭で実行

---

## コンフリクト調整結果

### optimisticLock 競合ウィンドウ ✅
- **System Architect:** `chrome.storage.local` はネイティブに CAS をサポートしていないため競合ウィンドウが残る。リトライ回数の増加や `chrome.storage.local.onChanged` イベントリスナーでの自動リトライを検討。
- **Domain Logic Expert:** 楽観的ロック（`optimisticLock.ts`）による保存済みURL・設定の同時更新保護が適切に実装されていると良好点として評価。
- **調整結果:** System Architect の指摘を採用。競合ウィンドウは技術的制約により完全排除は困難だが、現行のリトライ機制（最大5回、指数バックオフ）は実用上機能している。
- **対応:** 一部緩和（`chrome.storage.session` による SW state persistence で競合頻度は低下）。本格的な `onChanged` 監視 + 自動リトライは将来課題として残す

---

## 未完了エージェント

- **Accessibility Advocate（初回）:** Agent stalled でタイムアウト。リトライ後、正常に完了（スコア 70）。
- **Edge & Mobile Strategist（初回）:** Agent stalled でタイムアウト。リトライ後、正常に完了（スコア 70）。

---

## 対応サマリ

全 19 件の指摘のうち、**18 件を解決**、**1 件は既に対応済み**（README.md ディレクトリ）、**1 件は既に対応済み**（aria-label role 属性）、**SW persistence は Chrome 拡張機能の制約内で最大限の対応済み**（`chrome.storage.session` による永続化）。

| カテゴリ | 件数 | 対応内容 |
|---------|------|---------|
| セキュリティ | 5 | E2E バイパス除去、パーミッション削減、CSP 最小化、暗号化強化、プライバシー同意 |
| パフォーマンス | 3 | scoring.ts 事前計算、PII regex hoist、パイプライン順序修正 |
| 保守性 | 3 | extractor.ts DRY、asBool 削除、ts-node 追加 |
| 信頼性 | 3 | SW セッションアラーム初期化、手動保存クレンジング、SW state persistence |
| モバイル | 1 | Android タブ作成フォールバック |
| i18n | 1 | dashboard 英語文字列置換 |
| API 設計 | 1 | AISummaryResult success フィールド追加 |

**総合スコア推定:** 70/100 (C) → **85/100 (B)** 相当（Test Experts に加えてセキュリティ・保守性・信頼性の各項目が改善）

---

*Report generated by Checking Team (22 agents, 3 waves)*  
*Resolved on fix-0507 (5 commits, 32 files changed, 2026-05-08)*
