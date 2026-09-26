# Checking Team レビュー — アーカイブPBI 3件（設計ドキュメント）

- 対象: pbi/2026-09-06-01-feat-record-archive.md / -02-feat-archive-temp-open.md / -03-feat-archive-restore.md
- 実行: 標準レビュー（Wave1 5観点 + Wave2 4クラスタ16観点 + Wave3 Test Experts）
- graphify: `git ls-files` 2441件で大規模閾値超過のため構築スキップ（ワークフロー規定）。コード照合は各観点が直接 Read で実施

## 総合評価: 74/100 (ランク: B)

実行済み観点のスコア: Red 55 / Blue 55 / Architect 85 / Maintainability 55 / Legacy 55 / UX 96 / Ops 93 / Governance 96 / CodeQuality 98 / TestExperts 55

## 重要指摘事項（優先度順）

### [High] transport の無条件1回リトライがバルク破壊操作を二重実行し、件数表示を歪める
- 指摘者: Red Team Leader（+ Tuning / Test Experts 関連）
- 場所: src/background/offscreenTransport.ts:114-116,141-157
- 影響: 10万件級で10s超過が確実。タイムアウト後も offscreen/worker 側は処理継続し、リトライが同一操作を二重発行。最終状態は冪等でも2回目の応答（0件）がUIに表示され失敗と誤認される
- 対処: バルク系subtype（archive_create / archive_delete_by_staging / archive_restore）を transport リトライ対象外（noRetry）にし、タイムアウト時は「結果不明」表示

### [High] confirmToken が破壊パラメータ（cutoff / stagingName）に束縛されない
- 指摘者: Blue Team Leader（Red Team も Medium で指摘・同一問題）
- 場所: src/background/confirmTokenManager.ts:86-124 / dashboardGateway.ts:37-48 / dashboardSqlite/index.ts:39-60
- 影響: トークンは action+id のみ検証。プレビューした cutoff と異なる cutoff / 別タブの staging への差し替えが60秒窓内で検知不能
- 対処: `create_confirm_token` に scopeHash（sha256(cutoffMs | includeDeleted | stagingName)）を追加し verify で厳密比較・単回消費。「発行後に cutoff 変更→拒否」テストを sqlite-security-integrity.test.ts に追加

### [High] staging の正本（レジストリ）がなく、発行主体がPBI間で不整合
- 指摘者: Blue Team Leader
- 場所: PBI-02 敵対的反映§3 vs PBI-03 §B / PBI-01 フェーズB
- 影響: dashboard 指定名＋ファイル内 meta 再読みが DELETE/INSERT 述語の源泉になる。別セッションの staging 指名や meta 改変を区別できない
- 対処: offscreen メモリ内レジストリ（stagingName → {cutoffMs, includeDeleted, phase, createdAt}）を3PBI統一の正本に。PBI-03 incoming も offscreen 発行（archive_prepare_incoming）。レジストリとファイル meta の不一致は fail-closed。offscreen 再起動後は全 staging「再 preview 必須」。ファイル名は `^archive_(outgoing|incoming)_[A-Za-z0-9-]{36}\.db$` で検証

### [High] フェーズBの cutoff 述語がフェーズA後着行（復元・JSON import の過去 created_at）を未退避のまま削除する
- 指摘者: Code Quality / Data Integrity Expert
- 場所: PBI-01 敵対的反映§2（フェーズB定義）
- 影響: フェーズA〜Bは確認・ダウンロード待ちで数時間〜数日開く。後着の `created_at <= cutoff` 行が staging 未収録で物理削除される（VACUUM後復旧不能）
- 対処: フェーズAで MAX(id) を meta に `max_id_at_archive` 記録し、フェーズB述語を `WHERE created_at <= ? AND id <= :maxId` に限定

### [High] ARCHIVE_UPDATE の url スキーム検証欠落 ＋ アーカイブ行の描画ポリシー未規定
- 指摘者: Red Team Leader
- 場所: schema.ts:117-128（UPDATABLE_FIELDS に url）/ dashboard/historyEntryRow.ts:117-126（既存は isSecureUrl+textContent）
- 影響: 細工アーカイブの `javascript:` url や編集による url がそのまま保存・表示される。新規ビューが既存の innerHTML 慣行（40件超）に倣うと extension オリジン XSS → APIキー窃取・破壊操作実行に直結
- 対処: ARCHIVE_UPDATE の url 変更は isHttpUrl 検証（PBI-03と同一ヘルパー）。アーカイブビュー/編集モーダルは makeHistoryEntryRow 再利用または同等ポリシー必須、行内容の innerHTML 埋め込み禁止

### [High] 3PBI間の共通処理が「検討」止まり（三重実装リスク）
- 指摘者: Maintainability Guardian（Code Quality / Refactoring も Medium で指摘）
- 場所: PBI-03:108,114,244
- 影響: 一時エンジン生成・validateArchiveEngine・isHttpUrl・nonce・掃除が3箇所に複製され、検証穴が写経で3倍化する（handleRestore は写経元として不適格）
- 対処: 共通モジュール所有者を PBI-01 DoD に確定: `archiveValidation.ts`（allowlist検証＋突合せ＋トリガー0）/ `archiveStaging.ts`（発行・レジストリ・sweep・releaseStaging）/ `archiveGuards.ts`（isHttpUrl・cutoffMsFromLocalDate・サイズ上限定数。isHttpUrl は validators.ts をSSOT化）。PBI-02/03 は「使用必須（重複実装禁止）」に書き換え

### [High] archiveHandlers.ts への10ハンドラ集約（god file ＋ 二重 singleton）
- 指摘者: Maintainability Guardian（System Architect も Medium で指摘）
- 場所: PBI-01:229 / PBI-02:235
- 影響: opfsWorker は9ファイル分割済み。10ハンドラ集約＋`archiveEngine` と `handlerCtx.engine` の二重singletonは誤ルーティング・変更波及の温床
- 対処: archiveCreateHandlers（PBI-01）/ archiveSessionHandlers（PBI-02、`archiveEngine` をこのモジュールに閉じ込め getArchiveEngineOrThrow 経由のみ公開）/ archiveRestoreHandlers（PBI-03）/ archiveValidation.ts・archiveStaging.ts（共通）に分割。SW層ハンドラは stateless、セッション状態は offscreen/worker 層に閉じ込める

### [High] アーカイブ後もレガシーストアにゴーストが残り、resync の newest-first 窓で復元分が再同期されない
- 指摘者: Legacy Bridge Architect
- 場所: src/background/migration/legacyResync.ts:143-147,164-169 / saveMetadataStep.ts:23
- 影響: PBI-01 の物理削除後も `savedUrlsWithTimestamps` 側は残る。PBI-03 の復元分は旧 created_at で再挿入され newest-first 1000/5000 の窓外になり resync されない
- 対処: 実行前確認に「レガシーストアには残り続ける」明記。復元分の窓外制約を docs/SETUP_GUIDE.md 復元節に記載。`archive_delete_by_staging` 成功時のレガシー対応URL削除の可否調査

### [High] 既存 restoreDb（全体上書き）がアーカイブ.db を素通りで受理する
- 指摘者: Legacy Bridge Architect
- 場所: src/offscreen/opfsWorker/backupHandlers.ts:88-96
- 影響: アーカイブ.db（FTSなし・トリガー0・browsing_logsあり）は現行検証を通過し、全体復元UIで本体がアーカイブ内容で置換される（FTSは表面回復するため気づきにくい）
- 対処: handleRestore に「`yasumaro_archive_meta` 存在時は拒否（アーカイブ復元UIへ誘導）」の1行ガード。全体復元/アーカイブ復元のUI注意文言（i18n）。E2E 1ケース

### [High] 長時間アーカイブ系操作が単一シリアルキューを独占し、録画・履歴読み取りが全ブロック＋タイムアウト
- 指摘者: Tuning Expert（Ops/Performance）
- 場所: src/offscreen/opfsWorker.ts:289-321 / offscreenTransport.ts:18-19 / opfsWorkerProxy.ts:98-102
- 影響: フェーズA/B・復元INSERTがキューを占有し、録画書き込み・履歴一覧が待機。モバイルは5sタイムアウト・Mutexキュー上限50
- 対処: フェーズA・復元INSERTをバッチ分割（5000件/COMMIT。復元は INSERT OR IGNORE により再実行で収束）。`bench/` にアーカイブ相当の長時間系ケース追加を受入基準化

### [High] テスト設計の欠落（2フェーズ冪等・リトライ除外・トークン束縛・レジストリ・max_id / allowlist・url検証・handleRestoreガード・応答ガード）
- 指摘者: Test Experts
- 対処: テストケース A〜I（配置先つき）を各PBIのテスト戦略に追加（本文はテスト-experts 結果を PBI 反映節に収録）

## Medium 指摘事項

- [Medium] dashboard の OPFS 直アクセスは Layer 単方向依存を破る（Gateway バイパス）— System Architect。**コンフリクト調整: Architect の判断を優先**し、第1経路は offscreen 経由読み出し（handleBackup の getFile 流用・チャンク分割）。dashboard 直OPFS（archiveStagingService）は F-1 スパイク対象から「将来の最適化候補」に降格し、スパイク合格基準に「Gateway 経由フォールバック動作」を追加
- [Medium] 12 subtype の一括追加は第4グループ（`ARCHIVE_SUBTYPES` + createArchiveHandler）に分離すべき（stateless でないため maintenanceBatchHandler に混ぜない。GROUPED_SUBTYPES assert を4分割）— System Architect
- [Medium] archive_query の per-subtype 上限検証（query 1_000字 / limit 500 / offset 非負 / LIKE特殊文字のサーバ側エスケープ）。meta 由来表示は textContent 限定 — Blue Team
- [Medium] ステージング掃除のSSOT: `sweepOrphanStagings(exclude: Set<string>)` 1関数に集約し、呼出点は起動時・次回実行時・明示cleanupの3点のみ。ハンドラの finally は `releaseStaging(name)` に統一 — Maintainability
- [Medium] table_xinfo 照合ポリシーの仕様化: 不足列は staging に補完（ALTER TABLE ADD COLUMN 相当）して開く・余剰列は COLUMN_NAMES 射影で無視・hidden/generated は拒否継続。`migrateArchiveStaging(engine)` を ARCHIVE_OPEN / RESTORE 冒頭で適用。テスト「現行より1列少ない自作アーカイブが開けて復元できる」— Legacy Bridge
- [Medium] 長時間処理のUI: ボタン・入力の disabled 化＋既存 status-message（aria-live=polite、aria-busy）で「処理中・再実行不可」通知。プログレスバー新規部品は不要 — UI Expert
- [Medium] archiveEditModal のフォーカス管理規定: showConfirmDialog 同等（role=dialog + aria-modal + Tab trap + Esc + 復帰）。focusTrapManager 再利用 — Accessibility
- [Medium] 件数・日時表示はプレースホルダー化（`{restored}` / `{skipped}`、data-i18n-args の ruleCount 先例）＋ロケール形式の日時整形 — i18n Expert
- [Medium] アーカイブ一時オープン中のアイドルTTL/リース欠落と構造化ログ欠落 — SRE。調整: TTLは初版不採用（再接続仕様で可視化・回収）。フェーズA/B・復元・VACUUMの開始/終了/件数/所要ms/freelist前後の構造化ログを受入基準に追加
- [Medium] OPFS quota プレフライト（本体×2＋ステージング上限の空き確認、不足時は実行拒否＋案内）。200MB上限の worker 側強制（3PBI共通定数）— FinOps
- [Medium] PRIVACY.md 更新の必須記載項目: (a) アーカイブ.db は平文（暗号化・署名なし）(b) 保管・削除はユーザー責任 (c) 削除済み行を含めた場合 GDPR Art.17 で削除済みデータがファイル内に残る旨 — Compliance
- [Medium] ERROR_CODES.md 未登録: archive 系コード（ARCHIVE_ALREADY_OPEN / ARCHIVE_INVALID / ARCHIVE_STAGING_EXPIRED 等）の登録とエラー文字列の列挙表固定、`code` フィールド可否を G レビューへ — API & Contract
- [Medium] アーカイブ形式の互換契約: `yasumaro_archive_meta` に `archive_format_version=1` を追加し「v1 リーダー維持・列追加時は未知列無視」を受入基準化 — API & Contract
- [Medium] フェーズBの max_id 述語（上記 High に統合済み）— Data Integrity

## コンフリクト調整結果

1. dashboard OPFS 直アクセス（deep-dig 決定）vs System Architect のレイヤー指摘 → **Architect 優先**: 第1経路を offscreen 経由読み出しに変更し、dashboard 直OPFS は将来最適化に降格。F-1 スパイクの目的を「offscreen 経由転送が10s内に収まるか（チャンク分割含む）」に変更
2. 長時間操作の進捗（Tuning: ハートビート復活案）vs 敵対的レビュー反映§6（archive_status 廃止）→ **廃止を維持**し、バッチ分割＋noRetry＋「結果不明」表示＋UI disabled/aria-live で解消
3. PBI-03「部分更新禁止」vs Tuning バッチ分割 → INSERT OR IGNORE による再実行収束で両立（受入文言を「失敗時も冪等再実行で完結できる」に修正）
4. staging 発行主体（PBI-02 敵対§3 offscreen生成 vs PBI-03 dashboard書き込み）→ Blue Team のレジストリ案を採用し3PBI統一（PBI-03 は archive_prepare_incoming で offscreen 発行名を取得）

## 対象外としてスキップした観点
なし（関連性マップ判定で全クラスタ実行）

## キャッシュを再利用した観点
なし

## 未完了の観点
なし
