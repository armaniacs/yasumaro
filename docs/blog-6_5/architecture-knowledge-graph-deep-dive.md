# 知識グラフで Yasumaro のアーキテクチャを可視化してわかったこと — 4本の脊椎と2つの島、そして放置されている技術負債

[日本語](#日本語) | [English](#english)

---

## 日本語

### はじめに

Yasumaro は Manifest V3 の Chrome 拡張機能で、閲覧したページを AI で要約し、Obsidian や SQLite に記録します。コードベースは `src/` 以下に 8000 以上のシンボルを抱え、規模としては中〜大規模です。

この記事では、コードベース全体を `graphify` という知識グラフツールで解析し、「このシステムの本当の中心はどこか」「どこに技術負債が眠っているか」を客観的に浮き彰りにした結果を報告します。結論から言うと、**システムは 4 本の横断的ユーティリティ（脊椎）が Recording Pipeline で収束する構造**であり、かつ**ドキュメントとコードが別の島に分かれている**という 2 つの大きな特徴がありました。

---

### 発見 1: システムは「4 本の脊椎」が 1 点で収束する

グラフの中心性（どれだけ多くのモジュールとつながっているか）上位は以下の通りです。

| 順位 | シンボル | 次数 | 役割 |
|------|----------|------|------|
| 1 | `errorMessage()` | 203 | 例外を安全に文字列化 |
| 2 | `storage.ts` | 197 | 設定・ストレージ統合 |
| 3 | `getMessage()` | 177 | i18n メッセージ取得 |
| 4 | `getSettings()` | 154 | 設定取得 |
| 5 | `service-worker.ts` | 144 | バックグラウンド起点 |
| 6 | `logger.ts` (`addLog`/`logError`) | 128/98 | 構造化ログ |

これらは機能ドメイン（Obsidian 連携、AI プロバイダ、pipeline steps…）ではなく、**あらゆるレイヤーから呼ばれる横断的ユーティリティ**です。とくに `errorMessage()` は 43 のコミュニティをまたぐブリッジになっています。

追跡してわかった実際の呼び出しチェーンはこうです。

```
errorMessage() → logError() → writeStructuredLog() → addLog()
   → sanitizeLogDetails() → sanitizeRegex()（piiSanitizer.ts）
   → chrome.storage.local['sanitization_logs']
```

つまり「エラー発生 → 文字列化 → 構造化ログ → **PII マスク** → 永続化」という一本のパイプラインが、全ドメインの例外を束ねています。PII マスクが呼び出し元ではなく `addLog()` の基盤層で強制されているのは、設計として正しいポイントです。

もう一つの脊椎 `getSettings()` は、`recordingLogic.ts` から `RecordingPipeline.execute(data, settings)` に設定を注入し、ここで「設定脊椎」「ログ脊椎」「SQLite 脊椎（SqliteClient）」「プライバシー脊椎（privacyPipeline）」の 4 本がすべて交差します。

Recording Pipeline そのものは 13 のステップを順次実行し、ステップごとに `FATAL` / `RETRY` / `BEST_EFFORT` のエラー戦略を切り替えます。失敗時は `addPendingPage()` で記録漏れリカバリキューに回します。

---

### 発見 2: グラフは「コード島」と「ドキュメント島」に分断されている

知識グラフを構築すると、連結成分は 605 個に分かれました。しかし最大 2 つだけで全体の 56% を占めます。

- 成分 A（3358 ノード）: すべて **コード**
- 成分 B（1327 ノード）: すべて **ドキュメント**（ADR / CHANGELOG / README / blog）

つまり、`errorMessage()` が 40 以上のコミュニティをまたぐといっても、それは「コード島の内部」の話です。ADR や PBI で語られている設計意図（「StorageKeys は単一ソースにする」等）は、対応するコードと **エッジで一切つながっていません**。

これは必ずしもアーキテクチャの欠陥ではありません。graphify のセマンティック抽出はデフォルトで「ドキュメント → コード」の逆リンクを張らないため、抽出の死角とも言えます。しかし実務上、「ADR で決めたことがコードにちゃんと反映されているか」をグラフから追うことはできない状態です。

---

### 発見 3: 設定定義が新旧 2 系統に重複している

`StorageKeys` と `DEFAULT_SETTINGS` という、設定の根幹をなす定数が **2 箇所に存在**します。

- 新統合系統（コミュニティ 5）: `src/utils/storage/types.ts`、`src/utils/storage/defaults.ts`
- 旧系統（コミュニティ 90）: `src/utils/storageSettings.ts`

実際のコードを確認すると、両方が並行して使われていました。

- `storageSettings.ts`（旧）は `settingsExportImport.ts` / `allowedUrls.ts` / `redaction.ts` / `tagUtils.ts` から import
- `storage/settingsStore.ts`（新）は `storage.ts` / `quota.ts` から import

`Settings` 型も `storageSettings.ts` と `storage/types.ts` の 2 箇所で別々に定義されています。ADR「2026-03-20 default-settings-single-source」で単一ソース化を決めていますが、**未完のまま並行稼働**している状態です。

---

### 開発者の方向け: すぐに効く改善案

1. **設定モジュールの統合を完了させる**
   旧 `storageSettings.ts` の利用者（settingsExportImport / allowedUrls / redaction / tagUtils）を新 `settingsStore.ts` に移行し、`Settings` 型を `storage/types.ts` の単一定義に集約する。これによりコミュニティ 90 の孤立を解消できる。
2. **ドキュメント↔コードの逆リンクを復元する**
   ADR / PBI から対応コードへの `references` / `implements` エッジを手動または lint で担保し、「設計意図 → 実装」のトレーサビリティを得る。
3. **コンテンツスクリプト層の孤立を解消する**
   `src/content/loader.ts`（c277）と `src/content/extractor.ts`（c46）は SW と `chrome.runtime.sendMessage` でしか繋がらず、AST 上は孤立している。注入経路を明示するドキュメントまたは型ベースのメッセージ契約で可視化する。
4. **`logger → piiSanitizer` の依存を抽出に可視化する**
   現状 AST が cross-file 呼び出しを辿れていないため、影響範囲調査で「ログ変更 → PII マスク波及」が見えない。import 解決の改善または explicit edge で補う。

---

## English

### Introduction

Yasumaro is a Manifest V3 Chrome extension that summarizes browsed pages with AI and records them to Obsidian and SQLite. The codebase holds 8000+ symbols under `src/` — a medium-to-large project.

This article reports what we learned by running the entire codebase through `graphify`, a knowledge-graph tool, to objectively surface "what is the true center of this system" and "where does technical debt hide". The short version: **the system converges 4 cross-cutting utility spines at the Recording Pipeline, and it has 2 separated islands — code and documentation.**

---

### Finding 1: The system converges 4 "spines" at one point

Centrality (how many modules a symbol connects to) ranking:

| Rank | Symbol | Degree | Role |
|------|--------|--------|------|
| 1 | `errorMessage()` | 203 | Safely stringify unknown errors |
| 2 | `storage.ts` | 197 | Settings/storage hub |
| 3 | `getMessage()` | 177 | i18n message lookup |
| 4 | `getSettings()` | 154 | Read settings |
| 5 | `service-worker.ts` | 144 | Background entrypoint |
| 6 | `logger.ts` (`addLog`/`logError`) | 128/98 | Structured logging |

These are not feature domains (Obsidian sync, AI providers, pipeline steps) but **cross-cutting utilities called from every layer**. `errorMessage()` alone bridges 43 communities.

The traced call chain:

```
errorMessage() → logError() → writeStructuredLog() → addLog()
   → sanitizeLogDetails() → sanitizeRegex() (piiSanitizer.ts)
   → chrome.storage.local['sanitization_logs']
```

A single pipeline — error → stringify → structured log → **PII masking** → persist — binds exceptions from every domain. PII masking is enforced at the `addLog()` base layer rather than at call sites, which is the correct design.

The other spine, `getSettings()`, injects settings from `recordingLogic.ts` into `RecordingPipeline.execute(data, settings)`. Here all four spines — **settings, logging, SQLite (SqliteClient), and privacy (privacyPipeline)** — intersect.

The Recording Pipeline runs 13 steps sequentially, switching `FATAL` / `RETRY` / `BEST_EFFORT` error strategies per step. On failure it routes to `addPendingPage()` for missed-record recovery.

---

### Finding 2: The graph is split into a "code island" and a "document island"

The knowledge graph has 605 connected components, but the top 2 alone cover 56% of nodes:

- Component A (3358 nodes): all **code**
- Component B (1327 nodes): all **documents** (ADR / CHANGELOG / README / blog)

So when `errorMessage()` bridges 40+ communities, that is *within the code island*. Design intent recorded in ADRs/PBIs (e.g. "StorageKeys should have a single source") has **no edge to the corresponding code**.

This is not necessarily an architecture defect — `graphify`'s semantic extraction does not, by default, draw document→code back-links, so it is partly an extraction blind spot. But practically, you cannot trace "is the ADR decision reflected in code?" from the graph.

---

### Finding 3: Settings constants are duplicated across old/new systems

`StorageKeys` and `DEFAULT_SETTINGS` — the root constants of settings — exist in **two places**:

- New integrated (community 5): `src/utils/storage/types.ts`, `src/utils/storage/defaults.ts`
- Old (community 90): `src/utils/storageSettings.ts`

Both are used in parallel in practice:

- `storageSettings.ts` (old) is imported by `settingsExportImport.ts` / `allowedUrls.ts` / `redaction.ts` / `tagUtils.ts`
- `storage/settingsStore.ts` (new) is imported by `storage.ts` / `quota.ts`

The `Settings` type is also defined separately in `storageSettings.ts` and `storage/types.ts`. ADR "2026-03-20 default-settings-single-source" decided to unify them, but they **still run in parallel, unfinished**.

---

### For developers: quick wins

1. **Finish unifying the settings modules.** Migrate old `storageSettings.ts` consumers (settingsExportImport / allowedUrls / redaction / tagUtils) to new `settingsStore.ts`, and consolidate `Settings` into the single `storage/types.ts` definition. This dissolves community 90's isolation.
2. **Restore document↔code back-links.** Guarantee `references`/`implements` edges from ADRs/PBIs to code via manual edges or a lint check, gaining design-intent → implementation traceability.
3. **Dissolve content-script isolation.** `src/content/loader.ts` (c277) and `src/content/extractor.ts` (c46) connect to the SW only via `chrome.runtime.sendMessage`, so they are AST-isolated. Make the injection path explicit via docs or a typed message contract.
4. **Make the `logger → piiSanitizer` dependency visible to extraction.** AST does not resolve the cross-file call today, so impact analysis misses "log change → PII mask propagation". Improve import resolution or add explicit edges.
