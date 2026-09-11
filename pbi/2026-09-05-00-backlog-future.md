# Backlog — 将来候補の統合台帳（2026-09-05 整理）

旧ラウンド backlog（0831a / 0902 / 0903 / 0904 arch2・perf / 0905 arch3・arch4・arch5・review-fixes）の全 PBI は実装・アーカイブ済み。本文書は各 backlog に散在していた**見送り・トリガー付き・製品判断待ち**の候補を 1 箇所に統合したもので、`pbi/` 配下の唯一の live 台帳である（ゲート付き PBI 32 を除く）。

着手条件はトリガー別に管理する。トリガー未発生の項目に着手しないこと。

## 日付ゲート

| 項目 | ゲート | 内容 |
|------|--------|------|
| [2026-09-05-32-refactor-wasqlite-sunset.md](2026-09-05-32-refactor-wasqlite-sunset.md) | **2026-12-17 以降**＋診断パネルで未完了報告ゼロ（ADR-014） | wa-sqlite 依存・移行系（migrationBackup / opfsMigrationV2 / Reader / Worker migrationV2）の削除。S。スパイク PBI-A |

## トリガー発生時に着手

| 項目 | トリガー | 内容 |
|------|----------|------|
| provider catalog 残債（06d 候補・5 項目） | 次に AI provider を追加するとき（`PROVIDER_REGISTRY` エントリ追加時） | `cspDomains.ts` の host-permission build 時生成・`cspValidator.PROVIDER_TO_DOMAIN`（Models.dev 由来の別レイヤ）・`aiLimits.PROVIDER_MAX_TOKENS` の catalog 吸収（出典管理が別課題）・`RemoteAIService` factory 分岐の `createProvider` 化（循環リスク要設計）・per-provider `StorageKeys`/`defaults` の型自動生成（単独 PBI 相当）。出典: 2026-08-31 backlog 06d（効果確認 2026-09-01 済） |
| text/tokenizer 3 系統 `splitSentences`/`toWordSet` の署名化 | 第 3 の similarity 消費者の出現 | 各 NOTE は正確で動作リスクなし（arch2・Speculative） |
| debug envelope のヘルパー化 | 次回 testConnection 改修時 | Gemini/OpenAI で debug envelope 組み立てが反復（形状差の検証が必要 — arch4/arch5 見送り） |
| `extractMainContent` string entry の削減 | bench の再計測タイミング（c1/c4 baseline 更新時） | entry 2 種は c1/c4 計測面として維持中（PBI 13・arch5 見送り） |
| concurrency idiom 統合 | 原子性バグが強制したとき | Mutex / storageTransaction / keySerializer / PersistentRetryQueue の横断整理（arch3/4/5 で 3 回見送り・新規欠陥なし） |

## 製品判断待ち

| 項目 | 判断内容 | 現状 |
|------|----------|------|
| `helpers.ts` deep-scan 機構の wire-or-delete | ルール 1 本の配線（製品判断）か機構削除（c3 ベンチ＋baseline メトリクス削除を伴う）か | 本番 consumer 0・実行時コスト ~0・NOTE で意図明示（arch2・RICE 13.3） |
| Option B: IDB 中間層の廃止可否 | 前提として fallback-only 到達率の測定が必要（テレメトリなし製品のため privacy 制約下の計測設計が先 — ADR-014「計測基盤を先に作る」の文脈） | 検索品質縮退（FTS→LIKE）を全利用者に転嫁するため未測定のまま決定禁止（スパイク Option B・判断保留） |

## 次ラウンド再評価（実行可能・優先度未確定）

**2026-09-07 に RICE 採点し PBI 化した（INDEX「2026-09-07 architecture review round」参照）:**

| 項目 | 状態 | PBI |
|------|------|-----|
| extractor test-support 再配置＋facade collapse＋GET_CONTENT testability | PBI 化済（RICE 5.7、着手可） | `2026-09-07-14-refactor-extractor-facade-collapse.md` |
| history-panel: tag-filter の SQL 移行（5000 over-fetch cap） | PBI 化済（RICE 6.0、**現時点では実装しない**） | `2026-09-07-15-fix-history-tag-filter-sql-migration.md` |
| history-panel: legacy `panel-history` 撤去 | PBI 化済（RICE 5.25、**現時点では実装しない**） | `2026-09-07-16-refactor-remove-legacy-history-panel.md` |
| InMemoryTransport の DELETE セマンティクス乖離 | PBI 化済（RICE 4.4、着手可） | `2026-09-07-17-refactor-inmemory-delete-drift-doc.md` |
| `opfsSpike.ts` の去就 | PBI 化済（RICE 1.17、着手可。過去 issue に OPFS 関連ゼロ → 削除方向） | `2026-09-07-19-refactor-remove-opfs-spike.md` |
| dashboard 直書き英語 第2弾 | PBI 化済（RICE 563、次に着手。`consented` 未定義は実バグ） | `2026-09-07-13-fix-dashboard-i18n-strings-round2.md` |

**据え置き（PBI 化せず。RICE が低い／トリガー未発生）:**

| 項目 | 現状 | 出典 |
|------|------|------|
| AI slot-runner 統合 | summary loop（length-gate）と test loop（progress/timing）の差分は意図的と再確認（2026-09-07）。重複は for ループ骨格 約8行、実行時コスト0、バグ源になった記録なし。RICE 0.5。3 つ目の slot consumer が設計に現れるまで見送り | arch4/arch5 見送り |
| fallback 再入ギャップ | OPFS 復活時に IDB 経由の fallback 移行（`tryMigrateFallbackToSqlite`）が発火しない経路。実害はレアケース（次回 SW 再起動時に `OpfsRecoveryService` が回収、データロストなし）、Effort 1.0〜1.5週。**PBI 32（サンセット）で Option B（IDB 中間層廃止）を選ぶ場合のみ優先度繰り上げ** — それまで PBI 32 の設計時考慮事項に留める | スパイク移行経路表 |
| PBI-B 測定基盤の設計 | fallback-only 到達率を privacy 制約下で計測する設計（診断 STATUS の `compileOptionsSource` 集計は要設計） | スパイク PBI-B 前提 |

**2026-09-07 round 2（arch-delivery-loop・0907a ブランチ）で台帳入り（5 項目）:**

| 項目 | RICE | 再評価条件 |
|------|------|-----------|
| Archive validation 三つ巴（validateStructure / validateColumns が同一 PRAGMA reader を二重保持、`readArchiveMeta` は 1 flag の浅い wrapper、backupHandlers の trigger-count 検査は「コピー禁止」警告付き） | 4.8 | **PBI 21/22 着地後**（archiveSessionHandlers・archiveValidation を共有）※2026-09-09 再評価: PRAGMA reader は統合済み、残渣 ~−10LOC は下記 round 3 台帳に移管 |
| SqliteHistoryModel 21 メソッド → 8（フィルタ系 8 メソッドを `HistoryQuery` 値オブジェクト + `applyQuery(patch)` に畳む。onNavigateIn 順序制約の contract test が前提） | 5.25 | **PBI 2026-09-07-23（View 描画統合）着地後** — 同一ファイルクラスタ ※2026-09-09 再評価で RICE 2.5 に低下、下記 round 3 台帳へ |
| recordingHandlers の MANUAL/SAVE 双子（isSecureUrl + record 尾部 + byteStats 束の重複。`envelopePolicy` の extension-only 扱いを変えない条件で統合可） | 3.5 | envelopePolicy との相互作用を検討する次回 recording ハンドラ改修時 |
| Archive session 状態機械の二重化（worker `archiveDirty` と panel `archiveDirtyLocal` の同期点 3 箇所、single-flight 3 旗が 2 流儀 4 実装、テスト用内部リセット関数 30+ 参照） | 3.0 | panel 写しを「毎回 status RPC」に置き換える latency 体感の検討後（`ArchiveSession` 値オブジェクト + `withSingleFlight` への統合が解の骨格） |

（UPDATE 許可フィールドの 4 枚舌リスト（RICE 6.0）は 2026-09-09 round 3 の PBI 02 で実装済み — 履歴は `dev-docs/archived/pbi/2026-09-09-02-refactor-update-whitelist-ssot.md`）

**2026-09-09 round 3（arch-delivery-loop・0909a ブランチ）で台帳入り（5 項目）:**

| 項目 | RICE | 再評価条件 |
|------|------|-----------|
| archivePanel.ts（547 行）の 5 関心分離（create/purge/session+modal/reconnect/restore が 1 mount に混在、`ArchiveSessionRowLike` 同一ファイル内 2 重定義） | 2.7 | 次回 archive panel 機能追加時（`asyncData/` パターンをテンプレに） |
| trustSettings.ts のタグリスト 3 コピー → TagListController（threshold の `chrome.storage.local.set` 直呼びも SSOT 外） | 2.7 | 次回 trust 設定改修時 |
| Archive validation 残渣（hidden-column ガード ×2・shallow `readArchiveMeta`・`parseColumnTypesFromSchema` 無 memo 化・close-on-reject 3 流儀。~−10LOC） | 2.7 | 次回 archive 系作業に同梱 |
| SqliteHistoryModel 21→8 畳み込み（contract test `sqliteHistoryModel.navigate.test.ts` 既存。着手時は `toHaveLength(21)` pin を更新） | 2.5 | テスト改修 ~200 行に対する payoff 再評価後 |
| statusPanel の render-only 狩窄（`recordBtn.disabled` 二重所有解消・cleansing if-chain テーブル化） | 1.6 | recordBtn 二重所有の bug が顕在化したとき |

（statusPanel recordBtn 二重所有は 2026-09-11 再評価で**解消済み**を確認 — PBI 2026-09-05-06 / 2026-09-07-24 の着地で RecordSession が唯一の書き手。cleansing if-chain テーブル化は 2026-09-11 round 4 の PBI 05 で実装済み）

**2026-09-11 round 5（arch-delivery-loop・0911b ブランチ）で台帳入り（7 項目）:**

| 項目 | RICE | 再評価条件 |
|------|------|-----------|
| sqliteMessages.ts 分割（wire / responses / legacy constants）+ OffscreenResponse 完全性の型ガード（exhaustive assert） | 6.0 | 次に archive/STATUS 改修時（union の 6 変数欠落は round 5 PBI 03 で解消済み） |
| StorageBackend capability query（supportsArchive — round 4 で意図的先送り） | 8.0 | archive panel gate 改修時 |
| popup 3 重 GET_CONTENT coalescing（popup lifetime 計測が前提）+ i18n 英語フォールバック撲滅（`(getMessage(key) \|\| 'English')` の全数洗い出し） | 5.3 | popup lifetime 計測後 / 次回 popup UI 改修時 |
| content scheduler 統合（throttle rAF / IdleScheduler / DeadlineTimer の 3 系統）+ ContentKernel.dispose + cleansing PoC wire-or-delete（content bundle 計測が前提） | 5.3 | 次回 content perf 改修時 |
| 小型バグ群（全件 2026-09-11 round 5 で現存確認・file path 一部移動済）: throttle beforeunload listener 漏れ（src/content/throttle.ts:32-39）・DeadlineTimer 非null assert（deadlineTimer.ts:70,97）・**previewPresenter promise leak（:219-228 — popup modal で永久ハング、最も本物に近い）**・CSP/allowlist 3 テーブル drift（urlWhitelist ⊊ cspValidator ⊆ manifest）・cleanse flag 毎回 storage 読み（cleansingOffscreenDelegate.ts:13-25）・focusTrap map 無境界（focusTrap.ts:48-55） | — | 個別に顕在化したとき（previewPresenter hang は popup modal 不具合報告時に最優先） |
| dailyNotePath %2e%2e | — | **sink 追跡完了（round 5）**: URL path 経由だが attacker は自分自身の OBSIDIAN_DAILY_PATH 設定のみ → 脆弱性昇格せず。hardening（%2e-aware reject in sanitizePathComponent）として随時可 |
| ADR 2026-08-27-limit-policy / panel-lifecycle-wave1 の status note 追加 | — | PBI 08 で limit-policy は対応済み。wave1 は次回 panel lifecycle 改修時 |

（round 4 台帳の InMemoryTransport default-limit 乖離は round 4 で解消済み、query cap 統合のトリガーは round 5 で発火し PBI 08 として完了）

**2026-09-11 round 7（arch-delivery-loop・0911a ブランチ）で台帳入り（2 項目）:**

| 項目 | RICE | 再評価条件 |
|------|------|-----------|
| e2e gap: history panel UI spec（tag filter / pagination / star — High）+ cleansing preview confirm-send spec（High） | 4.0 | e2e 実行可能環境（xvfb あり）でのラウンド — 本環境では check-e2e が skip になり新規 spec を実行検証できない |
| popup/settingsScreen 復活の要否（dead code は round 7 PBI 04 で削除済み — 将来 settings 画面を戻す場合は新規実装） | — | 製品判断が出たとき |

（round 6 台帳の「i18n 未使用キー手動パス」は round 7 PBI 02 で機械化・実行（104 key 削除・残り 177 件は kept 判定）。「cleanse flag cache」は round 7 PBI 05 で解消。台帳トリガー駆動項目（archive codec / testConnection / Local AI / DialogShell / trustSettings / archivePanel 分離 / SqliteHistoryModel / DashboardSqlite 3-seam / ErrorTaxonomy / offscreen-cleanse PoC）は全件トリガー未発火で維持。）

**2026-09-11 round 6（arch-delivery-loop・0911a ブランチ）の主要な完了事項:**
DeadlineTimer getter 非対称解消、queryNormalize ids 上限、previewPresenter settle 単一 seam（promise 永久ハング解消）+ focus trap 単一 owner、i18n 参照済み欠落 50 件補完 + 未使用キー検出器、LIST_SOURCES 単一テーブル（OISD gate/grant 不一致解消）、pending region 摩擦解消、throttle 再実装、limits drift ガード拡張（10MiB family 6 件吸収）、popup 二重配線削除。

（round 5 台帳の「previewPresenter promise leak」「throttle leak」「DeadlineTimer 非null assert」「CSP/allowlist drift」「focusTrap 無境界」は **round 6 PBI 01/03/05/07 で解消済み**。「dailyNotePath %2e」は round 5 の sink 追跡で昇格見送り確定。）

**2026-09-11 round 5（arch-delivery-loop・0911b ブランチ）の主要な完了事項:**
pending pages の SQLite パネル移設 + legacy panel-history 撤去（〜−1,600 LOC）、STATUS extras 単一 field list 化、search+tag / ids 条件セット統合、上限定数 14 箇所の limits.ts 取り込み（drift ガード新設）、popup クラスタ修正（recordBtn sole-writer 契約回復）、クレンジング reason の resolveCleanseReason 統一、queryNormalize ids 検証、e2e version pin 撤去。

**2026-09-11 round 4（arch-delivery-loop・0911a ブランチ）で台帳入り（10 項目 + 小型バグ群）:**

| 項目 | RICE | 再評価条件 |
|------|------|-----------|
| testConnection を generateSummary の template hook 化（Gemini ~130 行 / OpenAI ~85 行の骨格重複・debug envelope 組み立て反復） | 6.4 | 次に HTTP provider を追加・testConnection 改修時 |
| Local AI session manager（session 毎 call create/destroy・`prompt()` 無 timeout/AbortSignal・overflow retry 無し。adapter 3 層の畳み込みも含む） | 6.0 | local AI 不調の報告時 / 次回 LocalAIService 改修時 |
| archive codec の 5 projections → descriptor 1 箇所（0909-05 の続き。project / pickProjectedFields / ARCHIVE_GATEWAY_DECODERS / projectDeps / decodeResponse が field-for-field で一致する必要） | 4.8 | 次に archive op を追加するとき |
| query cap/alias 統合（4 clamp・3 predicate・alias 3 流儀）+ limits.ts 外の上限 5 件取り込み（log-forward 3 / MAX_QUERY_LIMIT / MAX_TOKENS_PER_CALL）+ 8MB chunk 二重定義 + InMemoryTransport default-limit 乖離 | 4.8 | 上限 drift を次に検出したとき |
| DialogShell（preview view/presenter の trap 二重所有・`getConfirmHandlers` が interface 越えテスト面・focusTrap map 無境界） | 4.0 | 次に modal 系 a11y 改修時 |
| offscreen-cleanse PoC wire-or-delete（isolation seam を跨ぐ浅い module・content bundle に strip engine が静的添付・flag 毎回 storage 読み・flag OFF） | 4.0 | flag ON の製品判断時（静的→dynamic import は小型 fix として分離可能） |
| ErrorTaxonomy（4 分類器 errorClassification / popup errorUtils / categorizeError / mapConnectionError 系 + ERROR_CODES.md 未参照・statusCode 0 の正規表現） | 3.2 | エラー分類大改修時（段階移行必須） |
| DashboardSqlite deps 30 メソッド shallow adapter → query/mutate/maintain 3 seam + READ_ONLY/TOKEN_EXEMPT 統合（セキュリティゲート触及・dashboardSqliteMock 対応が必要） | 2.7 | dashboard-sqlite ハンドラ改修時 |
| SqliteEngineHost 14 accessor 崩し + getBackend/ensureBackend キャッシュ二重経路（stale backend の恐れ） | 1.6 | init/fallback 系バグが顕在化したとき |
| 小型バグ群（各個に顕在化時 fix）: throttle beforeunload listener 漏れ（src/content/utils/throttle.ts:32-39）・DeadlineTimer 非null assert で pre-init crash（deadlineTimer.ts:70,96-106）・previewPresenter promise leak（DOM 欠損で永久ハング・:227-236）・CSP/allowlist 3 テーブル membership drift（nsfw.oisd.nl / tranco-list.eu）・cleanse flag 毎回 storage 読み（cleansingOffscreenDelegate.ts:13-25）・focusTrap map 無境界（focusTrap.ts:49-54）・dailyNotePath の %2e%2e 通過（sink 実証後 security fix 昇格） | — | 個別に顕在化したとき |

## 運用

- 次ラウンドの architecture review（`/improve-codebase-architecture`）は本台帳を入力に再評価する
- トリガーが発火した項目は PBI 化（`pbi/YYYY-MM-DD-NN-type-slug.md`、NN は INDEX の番号予約ルールに従う）し、本台帳の行に完了印
- 実装済み・不要になった項目は行を削除（履歴は各ラウンドのアーカイブ履歴が保持）
