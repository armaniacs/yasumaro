# Backlog: 大局的コードレビュー 2026-09-29 の改善 PBI 群

大局的コードレビュー（holistic-code-review skill 実行）の報告書から抽出した 10 候補を RICE 採点し、PBI 化した一覧。証拠の file:line は各 PBI に記載。レビューは並列サブエージェント調査（queue/AI プロバイダ/ダッシュボード/ストレージ/堅牢性の 5 系統）+ 主要指摘の実コード裏取りで実施。レビュー報告書の全文は会話ログ参照。

## RICE スコア表（降順）

RICE = Reach（今後 1 年の関与頻度 1-10）× Impact（3=実害解消 / 2=大きい / 1=中）× Confidence ÷ Effort（SP）。同点はリスク軽減効果→時間的緊急度で決定。

| 順位 | NN | 候補 | RICE | R/I/C/E | 依存 |
|---|---|---|---:|---|---|
| 1 | 31 | [fix-audit-log-retention-and-clear-all](2026-09-29-31-fix-audit-log-retention-and-clear-all.md)（`audit_log` 保持 + `clear_all` カバレッジ） | 36.0 | 6/3/100%/0.5 | — |
| 2 | 32 | [fix-tag-panel-navigation-and-rtl-ssot](2026-09-29-32-fix-tag-panel-navigation-and-rtl-ssot.md)（tagsPanel dead ナビ + RTL 一本化） | 18.0 | 3/3/100%/0.5 | —（PBI 2026-09-24-13 の「記録済み逸脱」を実害判定で反転） |
| 3 | 33 | [fix-logger-key-name-masking](2026-09-29-33-fix-logger-key-name-masking.md)（logger へのキー名マスキング接続） | 16.0 | 4/2/100%/0.5 | — |
| 4 | 34 | [fix-background-seam-residue-bundle](2026-09-29-34-fix-background-seam-residue-bundle.md)（DI 配線 / 計測 lock 内化 / feedbackQueue lock / idle listener） | 10.0 | 5/2/100%/1.0 | 台帳行（[refactor-round:61](2026-09-28-00-backlog-refactor-round.md)）と同ファイル → 記録照会 |
| 5 | 35 | [fix-ai-provider-failure-contract-unify](2026-09-29-35-fix-ai-provider-failure-contract-unify.md)（FailureMetadata / BuiltIn 生エラー / 空文字成功 / pinned origin / parity 拡張） | 9.0 | 5/2/90%/1.0 | `ProviderStrategy.ts` は進行中 PBI 29 と触碰の可能性 → 着手前に状態確認 |
| 6 | 36 | [fix-opfs-worker-runtime-degradation](2026-09-29-36-fix-opfs-worker-runtime-degradation.md)（worker 死亡時の IDB 再解決） | 6.4 | 4/2/80%/1.0 | — |
| 7 | 37 | [refactor-sqlite-backend-boot-purge-search-unify](2026-09-29-37-refactor-sqlite-backend-boot-purge-search-unify.md)（DB_FILENAME / boot / purge 計数 / searchExecution） | 2.4 | 4/1.5/80%/2.0 | 38 と同点 → purge 計数の正確性（リスク軽減）で先行 |
| 8 | 38 | [refactor-dashboard-duplicated-logic-consolidation](2026-09-29-38-refactor-dashboard-duplicated-logic-consolidation.md)（接続テスト runner / Tranco 判定） | 2.4 | 3/1.5/80%/1.5 | 37 と同点（リスク軽減で 37 先行） |
| 9 | 39 | [refactor-provider-strategy-responsibility-split](2026-09-29-39-refactor-provider-strategy-responsibility-split.md)（12 責務の分離） | 1.0 | 3/1/80%/2.5 | 35 の着地が前提。台帳行（[refactor-round:62](2026-09-28-00-backlog-refactor-round.md)）と合流点 |
| 10 | 40 | [refactor-dashboard-legacy-module-factory-ization](2026-09-29-40-refactor-dashboard-legacy-module-factory-ization.md)（58 個の module-global 状態解消） | 0.8 | 3/1/80%/3.0 | [future.md:67](2026-09-05-00-backlog-future.md) の trustSettings 台帳行と照合 |

合計 13.5 SP。推奨バッチ: **{31, 32, 33}** → **{34, 35, 36}** → **{37, 38}** → **{39, 40}**（各バッチ内はファイル非重複で並列可。NN は順位順割り当てのため、ファイル名昇順=着手順）。

## レビューの構造評価（サマリー）

強み: 送信元認可の fail-closed 派生テーブル、`PersistentRetryQueue` によるキュー統一の完了、asyncData パネルの 4 層バックボーン、escapeHtml / failureTaxonomy / settings blob optimistic lock の横断正本化。課題は「正本 seam を作る能力が高い一方で、seam 周辺に旧実装が取り残される」パターンの反復（DI 未配線・修正済みバグの未修正 twin・2/3 カバーのテンプレート seam・起動時一回限りのフォールバック・旧形式モジュールの module-global 状態）。

## 対象外リスト

- `aiLimits.PROVIDER_MAX_TOKENS` の catalog 吸収 → 既存台帳 [2026-09-05-00-backlog-future.md](2026-09-05-00-backlog-future.md) が管理。本レビューの新証拠（下記「既存台帳への反映」）を台帳行に追記済み。PBI 化せず
- リトライ述語の重複（`ProviderStrategy.ts:600-610` × `fetch.ts:311-316`）→ 進行中 [2026-09-28-29-refactor-sender-seam-retry-normalization.md](2026-09-28-29-refactor-sender-seam-retry-normalization.md) のスコープ済み
- ProviderStrategy の error 文面逆パース除去 → 台帳行（[refactor-round:62](2026-09-28-00-backlog-refactor-round.md)）を維持。PBI 39 で合流
- 静か catch 群（crypto 系の `catch { return null }` 等）→ [2026-09-22-01-backlog-empty-catch-audit.md](2026-09-22-01-backlog-empty-catch-audit.md) が管理
- ニッチ指摘（i18n 直書き 17 箇所の exportLogsPanel、`sanitizeLogDetails` 以外の個別 DOM エスケープ等）は file 単位レビューの領域として PBI 化せず

## 既存台帳への反映

- [2026-09-05-00-backlog-future.md](2026-09-05-00-backlog-future.md) の「provider catalog 残債」行に新証拠を追記: `aiLimits.PROVIDER_MAX_TOKENS`（aiLimits.ts:7-17）は slot 実 id と乖離しており、slot id が `openai-compatible` に解決される groq/perplexity/openrouter/anthropic/claude/localai の cap は到達不能。`openai2`/`lm-studio`/`openai-compatible`/`built-in-ai` は欠落。幻の `'localai'` が builtInAIClient.ts:205 で使用
- tagsPanel の「記録済み逸脱」（[00-INDEX.md:389](00-INDEX.md) の PBI 2026-09-24-13 完了記録）に対し、production リスナ不在=クリック無反応という実害判定を PBI 32 で反転

## 依存マップ

```
35（契約 fix）──→ 39（ProviderStrategy 分離）
31/32/33/34/36/37/38/40 は相互独立
```
