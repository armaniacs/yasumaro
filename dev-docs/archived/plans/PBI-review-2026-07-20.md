# PBI: Checking Team レビュー指摘事項 対応計画

**作成日**: 2026-07-20
**レビュー日**: 2026-07-20
**総合スコア**: 61/100 (ランク: D)
**対象ブランチ**: `fix/checking-team-review-2026-07-20`

---

## 修正済み指摘事項

### ✅ [High] PII サニタイズ失敗時の不適切なフォールバック
- **指摘者**: Blue Team Leader
- **場所**: `src/utils/piiSanitizer.ts:354-360`
- **修正内容**: `catch` ブロックで `[SANITIZATION_FAILED]` プレースホルダーを返す代わりにエラーをスローするように変更。パイプラインが安全に中断される。
- **影響**: ログ出力（`logger.ts`）は呼び出し側の `try/catch` で保護されているため影響なし。プライバシーパイプライン（`processPrivacyPipelineStep.ts`）もエラーハンドリング済み。

### ✅ [High] `as unknown as MessageHandler` キャストによる型安全性の喪失
- **指摘者**: Code Quality
- **場所**: `src/background/service-worker.ts:271` 等（全13箇所）
- **修正内容**:
  - `MessageHandler` 型の定義を `void | Promise<void>` 戻り値型に変更
  - `MessageHandlerRegistry.dispatch` を fire-and-forget パターンに変更
  - `service-worker.ts` からすべての `as unknown as MessageHandler` キャストを削除
  - テストファイル（`MessageHandlerRegistry.test.ts`）を新しい動作に合わせて更新

### ✅ [High] CSP `'unsafe-inline'` の許可
- **指摘者**: Red Team Leader, Governance/Risk
- **場所**: `wxt.config.ts:65`
- **修正内容**: `style-src` から `'unsafe-inline'` を削除。以下のインラインスタイルをCSSクラス/JS DOM操作に移行:
  - `entrypoints/popup/index.html` — インラインstyle属性をCSSクラスに移行
  - `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` — `style="width:...%"` を `data-bar-width` + JS DOMに変更、`style="background:..."` を既存 `.warning-banner` CSSに変更、`style="display:none"` を `.hidden` クラスに変更
  - `src/dashboard/recordingConditionsSettings.ts` — `style="display:none"` を `.hidden` クラスに変更、`style.display` 操作を `classList` に統一
- **影響**: CSS インジェクションによる情報漏洩リスクを低減。ダッシュボードのCSP違反エラーを解消。

### ✅ [High] `chrome.storage.local.get()` 無引数呼び出し
- **指摘者**: Ops/Performance
- **場所**: `src/background/localMarkdownExportCore.ts:24`
- **修正内容**: `Object.keys(StorageKeys)` を使用して必要なキーのみを取得するように変更（前回セッションで修正済み）。

### ✅ [Medium] i18n 日本語翻訳キーの欠落（42キー）
- **指摘者**: UX/Frontend
- **場所**: `public/_locales/ja/messages.json`
- **修正内容**: 42個の欠落キーを日本語翻訳付きで追加。複数形（`_one`/`_other`）、トリガー設定、診断メッセージなど。

---

## 未対応の指摘事項（PBI として別途対応が必要）

### 📋 [High] マスターパスワード未設定時の API キー暗号化の脆弱性
- **指摘者**: Red Team Leader
- **場所**: `src/utils/storage/encryptionSession.ts:125-153`
- **影響**: マスターパスワード未設定時、暗号化キーが `chrome.storage.local` に平文で保存される。
- **推奨対処**: マスターパスワードの必須化、またはハードウェアバインドキー（`chrome.enterprise.platformKeys`）の導入。
- **優先度**: High（セキュリティ上の重大な脆弱性）

### 📋 [High] 4つの独立したマイグレーションシステムの同時実行
- **指摘者**: Legacy Bridge Architect, System Architect
- **場所**: `src/background/service-worker.ts:82-108`
- **影響**: 設定、セッション、SQLiteデータ、OPFS回復の4つのマイグレーションが順序制御なしに並行実行。
- **推奨対処**: `MigrationCoordinator` の導入、依存関係に基づいたトポロジカル順序での逐次実行。
- **優先度**: High（データ整合性リスク）

### 📋 [Medium] Service Worker での `setTimeout` 使用によるタスク消失
- **指摘者**: Blue Team Leader, Ops/Performance
- **場所**: `src/utils/optimisticLock.ts:109` 等
- **影響**: SW 終了時に `setTimeout` が消失し、リトライが実行されない。
- **推奨対処**: `chrome.alarms` への移行、または短期リトライ向けの即時リトライループ。
- **優先度**: Medium（SW ライフサイクルに依存）

### 📋 [Medium] CSP `wasm-unsafe-eval` の制限
- **指摘者**: Red Team Leader
- **場所**: `wxt.config.ts:65`
- **影響**: WASM-unsafe-eval が拡張機能ページ全体で許可されている。
- **推奨対処**: SQLite WASM を使用するオフスクリーンドキュメントのみに限定的な CSP を適用。
- **優先度**: Medium（セキュリティの多層防御強化）

### 📋 [Medium] API テスト接続エンドポイントの認証なしアクセス
- **指摘者**: Blue Team Leader
- **場所**: `src/background/service-worker.ts:299-314`
- **影響**: `TEST_CONNECTIONS`, `TEST_OBSIDIAN`, `TEST_AI` ハンドラが送信者検証なしに登録されている。
- **推奨対処**: 拡張機能自身のポップアップ/オプションページからのみ応答するよう `sender.origin` を検証。
- **優先度**: Medium（API キーの不正使用リスク）

### 📋 [Medium] 通知コンテンツによる URL/ページタイトルの漏洩
- **指摘者**: Blue Team Leader
- **場所**: `src/background/pipeline/RecordingPipeline.ts:325-330`
- **影響**: エラー通知にページタイトルと URL が含まれ、ロック画面で閲覧履歴が漏洩する。
- **推奨対処**: 通知メッセージからページ内容を除去、または汎用メッセージを使用。
- **優先度**: Medium（プライバシーリスク）

### 📋 [Low] `syncTargetRegistry.ts` / `syncTargets/` のデッドコード
- **指摘者**: System Architect
- **場所**: `src/background/syncTargetRegistry.ts`, `src/background/syncTargets/`
- **影響**: メインフローで未使用の同期ターゲットフレームワーク。
- **推奨対処**: パイプラインに接続するか、ファイルを削除。
- **優先度**: Low（保守性の改善）

---

## 修正ファイル一覧

| ファイル | 修正内容 |
|---------|---------|
| `src/utils/piiSanitizer.ts` | catch ブロックの `[SANITIZATION_FAILED]` → throw |
| `src/background/handlers/MessageHandlerRegistry.ts` | MessageHandler 型の更新、dispatch の fire-and-forget 化 |
| `src/background/service-worker.ts` | `as unknown as MessageHandler` キャスト削除、未使用 import 削除、dashboardSqlite try-catch追加 |
| `src/background/handlers/__tests__/MessageHandlerRegistry.test.ts` | テストの新しい動作への更新 |
| `src/__tests__/sqlite-security-integrity.test.ts` | dashboardSqlite ガードテストの正規表現→indexOfに変更 |
| `src/utils/__tests__/piiSanitizer-security.test.ts` | 到達不能アサーション4件を除去、throw対応に更新 |
| `src/utils/__tests__/piiSanitizer.test.ts` | タイムアウトテストをrejects.toThrow()に更新 |
| `src/utils/__tests__/piiSanitizer-redos.test.ts` | マッチ件数制限以内に反復回数を調整、skipSizeLimit追加 |
| `wxt.config.ts` | CSP `style-src` から `'unsafe-inline'` 削除 |
| `entrypoints/popup/index.html` | インラインスタイルを CSS クラスに移行 |
| `public/_locales/ja/messages.json` | 42個の欠落翻訳キー追加 |
| `src/background/localMarkdownExportCore.ts` | `chrome.storage.local.get()` のキー指定（前回セッション） |
| `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts` | HTMLインラインstyle属性をCSSクラス/JS DOMに移行 |
| `src/dashboard/recordingConditionsSettings.ts` | HTMLインラインstyle属性を.hiddenクラスに移行 |

## コミット履歴

| コミット | 内容 |
|---------|------|
| `bef25da` | chore: CSP style-src tightening, i18nメッセージ追加, popupインラインスタイル除去 |
| `22bdb2d` | fix(pii-sanitizer): sanitizeRegexの例外伝播方針変更にテストを追従 |
| `e1a2daa` | fix(message-handler): dispatchの未ハンドルPromise rejectionとdashboard SQLiteエラー伝播を修正 |
| `b8c3a2d` | fix(dashboard): CSP style-src 'self' 適用に伴うインラインスタイル属性を除去 |

## ビルド・テスト確認

- [x] TypeScript 型チェック通過 (`npm run type-check`)
- [x] テスト実行 (`npm test`) — 7167 passed / 373 files
- [x] ビルド確認 (`npm build`) — dist/chromium-mv3 生成完了
- [x] Chrome 拡張機能での手動動作確認（CSPエラー解消、正常動作確認済み）
