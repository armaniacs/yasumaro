# Backlog: arch-delivery-loop ラウンド 2026-10-10（archloop-1010）

arch-delivery-loop skill によるコードベース全体（差分スコープ）のアーキテクチャ診断と閉ループ実行。
4 系統の並列調査（background+offscreen / dashboard+popup / content+utils+messaging / 設約スイープ）を
13 個の独立実装単位に分解し RICE 採点して PBI 化（NN01-13）。

- 診断レポート: `/tmp/architecture-review-2026-10-10T0522.md`
- 差分スコープ: 過去台帳（holistic-1005 32件 / archloop-1006 23件 / archloop-1007 18件 / holistic-1009 20件）で閉じたテーマは対象外
- 台帳送り消費: F14（cleansingStatsView i18n — i18n カバレッジ改善時トリガー発火 → NN05）、F17（exportLogsPanel limit — export logs panel 触るトリガー発火 → NN05）、F19（connectionTests syncStatusToTop 冗長 — connection tests 触るトリガー発火 → NN13）

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 今後1年の保守作業での関与頻度（相対 1-10）
Impact: 3=実害解消 / 2=大きい / 1=中（重複削減・規範化）/ 0.5=小
Confidence: 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 依存 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 01 | [alarm-registry-wire-unification](2026-10-10-01-refactor-alarm-registry-wire-unification.md) | refactor | 8 | 3 | 1.0 | 2.5 | 9.6 | 2.5 | なし |
| 02 | [contentcleaner-hardstrip-drift](2026-10-10-02-fix-contentcleaner-hardstrip-drift.md) | fix | 6 | 2 | 1.0 | 1.5 | 8.0 | 1.5 | なし |
| 03 | [order-dir-resolve](2026-10-10-03-refactor-order-dir-resolve.md) | refactor | 4 | 1 | 1.0 | 0.5 | 8.0 | 0.5 | なし |
| 04 | [service-tokens-removal](2026-10-10-04-refactor-service-tokens-removal.md) | refactor | 7 | 1 | 1.0 | 1.0 | 7.0 | 1 | なし |
| 05 | [dashboard-i18n-literals](2026-10-10-05-fix-dashboard-i18n-literals.md) | fix | 8 | 2 | 1.0 | 3.0 | 5.3 | 3 | なし（messages.json 独占） |
| 06 | [cleansing-popup-dom-deadpath](2026-10-10-06-fix-cleansing-popup-dom-deadpath.md) | fix | 5 | 1.5 | 1.0 | 1.5 | 5.0 | 1.5 | なし |
| 07 | [auditlog-row-ssot](2026-10-10-07-refactor-auditlog-row-ssot.md) | refactor | 7 | 1 | 1.0 | 1.5 | 4.7 | 1.5 | なし |
| 08 | [readonly-list-params-planner](2026-10-10-08-refactor-readonly-list-params-planner.md) | refactor | 4 | 1 | 1.0 | 1.0 | 4.0 | 1 | なし |
| 09 | [persite-override-status](2026-10-10-09-refactor-persite-override-status.md) | refactor | 4 | 1 | 1.0 | 1.0 | 4.0 | 1 | 05（messages.json 参照） |
| 10 | [recording-trigger-allowlist](2026-10-10-10-fix-recording-trigger-allowlist.md) | fix | 4 | 1.5 | 0.8 | 1.5 | 3.2 | 1.5 | なし |
| 11 | [attempted-providers-wire](2026-10-10-11-refactor-attempted-providers-wire.md) | refactor | 4 | 1 | 0.8 | 1.0 | 3.2 | 1 | なし |
| 12 | [opfs-resolver-dead-wrapper](2026-10-10-12-refactor-opfs-resolver-dead-wrapper.md) | refactor | 3 | 0.5 | 1.0 | 0.5 | 3.0 | 0.5 | なし |
| 13 | [connection-tests-status](2026-10-10-13-refactor-connection-tests-status.md) | refactor | 4 | 0.5 | 1.0 | 1.0 | 2.0 | 1 | 05（messages.json 参照） |

## 実行順（確定）とバッチ計画

RICE 降順（依存を尊重）。同点は「リスク軽減 → 緊急性」の順:
- **8.0 の 2-way**: NN02（fix、実挙動 drift 解消）を先頭 — 種別規則（fix > refactor）。以後 NN03。
- **4.0 の 2-way**: NN08（drift 整合、05 依存なし）を先頭 — NN09 は 05 依存のため後 anyway。以後 NN09。
- **3.2 の 2-way**: NN10（fix、allowlist 分類の意図的変更）を先頭。以後 NN11。

| Wave | NN | 内容 | 非重複根拠 |
|---|---|---|---|
| W1 | 01 / 02 / 03 / 04 | alarm 配線（alarmRegistry+compositionManifest+service-worker）/ contentCleaner / sqliteQueryBuilder / serviceContainer | 4ファイル群が互いに非重複（04 は serviceContainer.ts のみ、01 は触らない） |
| W2 | 05 / 06 / 07 / 08 | dashboard i18n（messages.json 独占）/ aiSummaryCleansing / 監査ログ型 / readOnlyHandler | 05 が messages.json を独占、他は触らない。07 は deps.ts、08 は readOnlyHandler.ts で別ファイル |
| W3 | 09 / 10 / 11 / 12 | perSiteOverrides（05 着地後）/ recordingTrigger allowlist / providersTried / backendResolver | 11 は messaging/types.ts（07 は触らない）。12 は backendResolver.ts |
| W4 | 13 | connectionTests（05 着地後）+ 統合側の残処理 | settingsUiHelper は既存 seam のみ参照 |

**共通ファイル（統合側がバッチ境界で 1 回だけ更新）**: `pbi/00-INDEX.md`、本台帳。
W3 境界で messages.json の新規キーは NN05 がすべて追加済み（NN09/NN13 は参照のみ）。
新規 utils ファイルは本ラウンドでは作らない（NN01 の型 import は既存 pendingChromeStorageQueue.ts の型を参照するのみ）ため LAYERS.md 登録は不要。

## 台帳送り（見送り・トリガー管理）

| # | テーマ | 再検討トリガー |
|---|---|---|
| G1 | `entrypoints/background/index.ts:14-20` の `.then()` チェーン（Firefox main() 同期必須の文書化済み workaround。await IIFE 化で挙動不変に置換可） | 次に background エントリを触る時 |
| G2 | `guard`（service-worker.ts:34-45）と `fireAndForget`（headerDetector.ts:35-44）の同一 fire-and-forget 課形共通化（log 関数差は注入で表現） | 次に SW リスナー境界を触る時 |
| G3 | `src/content/extractor.ts:53-132` ファサードのテスト専用委譲 export 約 12 本の縮小 | 次に content extractor を触る時 |
| G4 | `visitReporter.Message` の手書き envelope（SSOT envelopeShape 派生へ） | 次に visitReporter を触る時 |
| G5 | GET_CONTENT 応答型の送受信不一致（`GetContentReply` vs `ContentResponse`、`as` 接合） | 次に popup content fetch を触る時 |
| G6 | `src/messaging/protocol.ts:11-13` NOTE stale（loader ハードコード複製は build-time define で解消済み） | 次に protocol.ts を触る時 |
| G7 | `src/privacy/privacy.ts:143-166` renderInline の残差エスケープ欠落（同梱アセット + CSP で実害低、escapeHtml 公約の構造的穴） | PRIVACY.md 以外の markdown 入力転用時 |
| G8 | `local/no-test-sleep` の `tests/` 未適用 + bare `setTimeout` 未検出（現状違反者なし） | tests/ 配下に sleep が積み上がった時 |
| G9 | nav-trail `onRemoved` の手書き catch + 別 log source tag（guard 統一の残留） | 次に SW リスナー境界を触る時 |
| G10 | 再 wire ポリシー三様（wireOnce / WeakSet / remove+add 手動ペア）の統合 | 次に dashboard リスナー初期化を触る時 |
| G11 | PBI 参照コメントの陳腐化掃除（両エリア大量残留） | コメント規約の機械的掃除ラウンド時 |
| G12 | `wordClusterAdapter.ts:32` SUMMARY_FALLBACK_LITERAL dead export | 次に wordCluster を触る時 |
| G13 | popup `errorUtils.ts` の純粋（判定/整形）と DOM（showError）分離 | 次に popup error 表示を触る時 |
| G14 | `src/privacy/privacy.ts:80-108` ネストリスト walk の自己双子 | 次に privacy markdown を触る時 |
| G15 | `src/content/pageState.ts` shim+module 二重役 | 次に pageState を触る時 |
| G16 | `aiSummaryCleansingSettingsV2` の 57 箇所素 `getElementById` の resolveDom() 化（NN06 のデッドパス除去後の第2段） | 次に AI クレンジング設定 UI を触る時 |
| G17 | `readOnlyHandler` の list 経路 orderBy/orderDir bake の後、`buildLikeOrderClause` が `orderBy !== 'created_at'` を `created_at DESC` に落とす語義を planner 側で文書化 | 次に LIKE fallback を触る時 |

- holistic-1009 台帳送り F1-F13/F15/F16/F18/F20-F24 + archloop-1007 L2-L8 はトリガー未発火のため台帳維持（本ラウンドのスコープで該当ファイルを触らない）。
- backlog-future 統合台帳のトリガー駆動項目はトリガー未発火で維持。

## 5 Whys サマリー（主要テーマ）

- 「なぜ alarm 配線が refs 経由になったのか」→ reviewSummaryGenerator と alarmRegistry の循環 import を避けるためファイル分割したが、コンテナ resolve による依存注入を再発見していなかったから。解: NN01
- 「なぜ ServiceTokens が残ったのか」→ compositionManifest 移行で register ブロックと keys union は廃止宣言されたが、serviceContainer.ts 内の定数実体の削除が対象リストから漏れたから。解: NN04
- 「なぜ count と strip が双子に割れたのか」→ 診断 recount（countCleanseTargets）が strip 実装とは別ラウンドで追加され、収集ヘルパーの抽出と parity pin が行われなかったから。解: NN02
- 「なぜ i18n リテラルがパネル群に増えたのか」→ getMessageOr seam が実在するのに、新規パネル（exportLogsPanel など）の status 文言が機械的ゲート（data-i18n 静的網羅）で捉えられない動的生成経路だったから。解: NN05
- 「なぜ監査ログの行形状が 8 箇所に増えたのか」→ wire 層・validator・gateway・protocol・service・TSV が別ラウンドで別々に作られ、型の所有を寄せる工程が無かったから。解: NN07

## レビュー報告書サマリー（4 観点）

- **強み**: compositionManifest・envelopePolicy・3枚の wire table・`SqliteResult<T>` 語彙は宣言どおり実装済み。SW stateless・動的コード実行禁止・escapeHtml canonical（popup/dashboard）・ESM .js 拡張子・offscreen 制限・tabs 権限裁定・version SSOT は全成立。
- **主な構造的課題**: (1) alarm 配線に DI コンテナと並行する第2機構（module-level refs）が残存し評価順序が無音の失敗モード (2) dashboard/popup の status 文言が getMessageOr seam を迂回する動的生成経路で増殖 (3) messaging 層内の型三重化（監査ログ行形状 8 箇所） (4) 実挙動 drift（contentCleaner count/strip 双子の hidden パス欠落）。
