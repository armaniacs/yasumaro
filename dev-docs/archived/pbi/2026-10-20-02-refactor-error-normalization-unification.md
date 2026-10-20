# PBI 02: エラー正規化の errorMessage 統一（約 30 箇所）

## ユーザーストーリー
メンテナーとして、エラー文字列化が 1 実装に集約された状態がほしい、なぜなら String(error) と errorMessage と instanceof Error 再ラップが 4 系統に分岐すると、エラーログの greppability が失われ、スタック保持の有無が呼び出し場所ごとに変わるから。

## 変更点の概要
canonical は errorMessage（src/utils/errorUtils.ts:13）。ログ用の文字列化を errorMessage へ、throw 用の Error 化を新設の toError ヘルパー（errorUtils に追加、Error はそのまま返しスタック保持）へ統一する。機能挙動は不変（診断文言の正規化のみ）。

## 現状と問題
- ログ用 String(error): src/background/sessionStore.ts:416 ほか 15 箇所/8 ファイル（alarmRegistry.ts:235,245 / aiTestProgressNotifier.ts:37,41 / localMarkdownExportCore.ts:89,93 / localMarkdownExportRetention.ts:154,235 / ollamaSettingsObserver.ts:25 / deferredMigrations.ts:58,73 / service-worker.ts:74,95）。同ファイルが errorMessage を import 済みの併存あり
- throw 用 instanceof Error 再ラップ 4 実装: src/popup/recordCurrentPage/recordSession.ts:415 / src/background/obsidianClient.ts:266 / src/background/allowedUrlsSync.ts:42,56 / src/utils/crypto/idbKeyStorage.ts:64 / src/utils/fetch.ts:452
- wasm 層 6 重複（src 全体 9 箇所）: src/wasm/tag-cooccur/index.ts:113,213 / initWasm.ts:65 / pii-sanitizer/index.ts:71 / textrank/index.ts:80 / sentence-dedup/index.ts:90 + src/utils/piiSanitizer.ts:405 / processPrivacyPipelineStep.ts:94 / saveToObsidianStep.ts:78
- dashboard inline ×2: src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:221,310
- storageFallback String(error) ×10: src/offscreen/storageFallback.ts:185,234,360,380,392,411,421,431,483,535（exportAllRecords のみ errorMessage :256）

## 変更の理由
[DRY/可読性] String(error) は Error を "Error: msg" にする一方 errorMessage は "msg" を返し、日志の形式が呼び出し場所ごとに割れる。再ラップも 4 実装でスタック保存の有無が不統一。errorUtils に受けてが既にある。

## 提案コード（骨子）
- ログ用: `error: String(error)` → `error: errorMessage(error)`
- throw 用: errorUtils に `toError(error: unknown): Error` を追加（Error はそのまま、それ以外は new Error(errorMessage(error))）
- storageFallback は errorMessage へ 1 行ずつ置換

## BDD受け入れシナリオ
Scenario: 非 Error throw のログ正規化
  Given 実装が文字列を throw する
  When catch 経路がログに載せる
  Then errorMessage 経由で元の文字列が記録される（'[object Object]' にならない）

Scenario: toError は Error を壊さない
  Given Error インスタンスが throw される
  When toError を通す
  Then 同一インスタンス（スタック保持）が返る

## 見積もり
2 pt（RICE: 60 = Reach 30 × Impact 2 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [x] toError の単体テスト追加（Error 突入・非 Error 突入）通過
- [x] 置換後の既存テスト全通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- canonical 追加: toError を src/utils/errorUtils.ts:25 に新設（Error は同一インスタンス＝スタック保持、非 Error は new Error(errorMessage(error))）。単体テスト 6 件追加
- String(error)/String(err) → errorMessage: 28 箇所 / 18 ファイル（ログ用 16・sqliteHistoryPanel 2・storageFallback 10）。instanceof Error 再ラップ → toError: 13 箇所 / 12 ファイル（throw 系 4・wasm 層 9）。allowedUrlsSync 2 箇所は errorMessage(再ラップ) → errorMessage(error) に数学的同一の簡約
- 旧形式 pin テスト 4 件（storageFallbackMutate:173・deferredMigrations:172/184・ollamaSettingsObserver:71）を正規化後の形式へ更新（各テストの主目的 pin は不変、仕様変更の直接の帰結）。errorUtils を vi.mock する 3 テストに toError mock 定義を補完
- 検証: PBI 対象 23 ファイルで対象パターン 0 件、フルスイート 16613/16614（失敗 1 件は ReDoS 壁時計測定の負荷由来、単独 --repeats=5 で 75/75 green）、type-check 通過、validate:fast green（772 ファイル / 11964 テスト）
