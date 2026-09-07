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

## 運用

- 次ラウンドの architecture review（`/improve-codebase-architecture`）は本台帳を入力に再評価する
- トリガーが発火した項目は PBI 化（`pbi/YYYY-MM-DD-NN-type-slug.md`、NN は INDEX の番号予約ルールに従う）し、本台帳の行に完了印
- 実装済み・不要になった項目は行を削除（履歴は各ラウンドのアーカイブ履歴が保持）
