# バックログ優先度一覧 — 2026-08-30 クレンジング改善

## この索引の読み方

- **対象**: `pbi/2026-08-30-01`〜`15` の 15 件。ブログ 6.5（クレンジング）執筆時に洗い出した積み残し 11 件 ＋ パターン網羅性で見落とされていた 3 件（i18n 拡充 / SPA 動的 / 観測性ファネル）＋ LLM 縮退出力の安全装置 1 件。
- **ファイル名の連番 `NN` は作成順であり、RICE 優先度とは一致しない**。着手順は下記「推奨実行順」に従う。`pbi/00-INDEX.md` の 30 系テーブルは RICE 降順で並べている。
- 各 PBI は `pbi-create-bdd` 準拠（ユーザーストーリー / ビジネス価値 / 優先度RICE / BDD シナリオ / 受け入れ基準 / テスト戦略 / 実装アプローチ / 見積もり / 技術的考慮事項 / 実装者向け注記 / DoD）。
- 29 系（VulnHunter セキュリティ修正）とは独立。ファイル触接もほぼない。

---

## 候補の列挙

| ファイル | タイトル | 種別 |
|---|---|---|
| 01 | クレンジング本文保護スコアを Mozilla Readability ベースに置換する | feat |
| 02 | クラス部分一致に依存しないセマンティック分類を導入する | feat |
| 03 | クレンジングの Shadow DOM / iframe 走査に対応する | feat |
| 04 | クレンジング74回走査の1パス集約を計測検証する | investigate |
| 05 | クレンジングの Offscreen Document 委譲でメインスレッド占有を削減する | feat |
| 06 | クレンジング32トグルをプリセットに束ねる | feat |
| 07 | クレンジングのドメイン別オーバーライドを可能にする | feat |
| 08 | クレンジング誤削除のフィードバックループを構築する | feat |
| 09 | クレンジングパターン衝突をコーパスでCI検出する | test |
| 10 | ホワイトリストアダプターをLLMで自動生成する | feat |
| 11 | クレンジングの透明性を高める二重ペイロード方式を導入する | feat |
| 12 | クレンジングの多言語パターンを拡充する | feat |
| 13 | SPA動的コンテンツのクレンジングタイミングを改善する | feat |
| 14 | クレンジングの観測性(ファネル/理由分解)を改善する | refactor |
| 15 | LLMの縮退出力（繰り返し・非文）を検出して保存・表示を抑止する | feat |

---

## 優先度付け — RICE

**計算式**: `RICE = (Reach × Impact × Confidence) / Effort`（Reach/Impact は 1–10 の相対値、Effort は日数。29 系とは尺度が異なる点に注意）

| 順位 | ファイル | Reach | Impact | Confidence | Effort | RICE |
|---|---|---|---|---|---|---|
| 1 | 12 i18n 多言語パターン | 6 | 2 | 0.8 | 1日 | **12.0** |
| 2 | 15 LLM 縮退出力ガード | 7 | 3 | 0.8 | 2日 | **8.4** |
| 3 | 04 1パス集約ベンチ | 5 | 2 | 0.8 | 1日 | **8.0** |
| 3 | 06 プリセット | 10 | 3 | 0.8 | 3日 | **8.0** |
| 5 | 02 セマンティック分類 | 9 | 2 | 0.7 | 2日 | **6.3** |
| 6 | 01 Readability スコア | 8 | 3 | 0.6 | 3日 | **4.8** |
| 7 | 09 コーパス CI | 5 | 3 | 0.7 | 3日 | **3.5** |
| 8 | 14 観測性ファネル | 8 | 1 | 0.8 | 2日 | **3.2** |
| 9 | 11 二重ペイロード | 6 | 2 | 0.5 | 3日 | **2.0** |
| 10 | 13 SPA 動的コンテンツ | 5 | 2 | 0.5 | 3日 | **1.67** |
| 11 | 03 Shadow DOM 走査 | 3 | 3 | 0.5 | 3日 | **1.5** |
| 12 | 07 ドメイン別オーバーライド | 4 | 3 | 0.6 | 5日 | **1.44** |
| 13 | 08 フィードバックループ | 6 | 2 | 0.4 | 5日 | **0.96** |
| 14 | 05 Offscreen 委譲 | 4 | 2 | 0.5 | 5日 | **0.8** |
| 15 | 10 アダプタ LLM 自動生成 | 3 | 2 | 0.4 | 5日 | **0.48** |

---

## 推奨実行順（依存関係と Wave）

RICE 順を基本としつつ、以下の依存・前倒しを反映する。

### 前倒し
- **15 LLM 縮退出力ガード**（RICE 8.4）— `diamond.jp` 記事で gemma3:1b が「豚肉 | 豚肉 …」の縮退出力を出し、Obsidian ノート・履歴 DB を汚染する実被害が確認済み。純粋関数 1 つ（`src/utils/llmOutputGuard.ts`）＋パイプライン 1 箇所組み込みで完結。**29 系 Wave 1 と並行して着手してよい**。

### Enabler（後続の前提）
- **04 1パス集約ベンチ**（RICE 8.0）— 実装ではなく計測。`querySelectorAll` 74 回の 1 パス集約の効果を実測する。**05 Offscreen 委譲の着手判断はこの計測結果に依存**する（効果が小さければ 05 は見送り）。
- **09 コーパス CI**（RICE 3.5）— 実サイト HTML コーパスでパターン誤爆を CI 検出する。**01 / 02 / 12 の回帰ネットになる**ため、RICE 順より前に土台（10 サイト・スクリプト）だけ作っておくと以降のパターン変更が安全になる。

### 依存注記
- **01 Readability スコア** と **02 セマンティック分類** はどちらも削除判定ロジックを触り、`src/utils/aiSummaryCleaner/bodyProtection.ts` / `helpers.ts` / `patterns.ts` で競合しうる。**09 を先に土台化**し、02 → 01 の順（02 の方が局所的）で着手するのが安全。
- **06 プリセット** は UI 中心でバックエンド影響が小さく、他 PBI と独立。RICE 順どおり早期に着手可。
- **14 観測性ファネル** は `ExtractResult` に `removed` map を含める変更。**11 二重ペイロード** と `ExtractResult` 型で触接するため、14 → 11 の順が望ましい。

### 保留候補（当面着手しない）
- **05 Offscreen 委譲**（RICE 0.8）— 体感効果が薄く、Offscreen ライフサイクル（30 秒破棄）とメッセージング往復で Effort が高い。04 の計測で効果が裏付けられた場合のみ再評価。
- **10 アダプタ LLM 自動生成**（RICE 0.48）— 新ドメイン対応の頻度が低く、LLM 推論精度も不確実。スパイクで精度を測ってから判断。

### 推奨 Wave
- **Wave A（並列可）**: 15 / 12 / 06 / 04
- **Wave B**: 09（土台）→ 02 → 01
- **Wave C**: 14 → 11、13、03
- **Wave D（必要になったら）**: 07 / 08
- **保留**: 05 / 10

---

## トレーサビリティ（PBI → 主要な触接ファイル）

| PBI | 主に触るファイル |
|---|---|
| 01 | `src/utils/aiSummaryCleaner/readabilityScore.ts`、`bodyProtection.ts` |
| 02 | `src/utils/aiSummaryCleaner/patterns.ts`、`helpers.ts`、`stripCore.ts`、`stripExtended.ts` |
| 03 | `src/utils/aiSummaryCleaner/helpers.ts`（`querySelectorAllDeep` 新設）、各 strip 関数、`bodyProtection.ts` |
| 04 | `src/utils/aiSummaryCleaner/index.ts`（計測フック）、`scripts/benchmark-cleansing.mjs`（新規）、`dev-docs/`（レポート） |
| 05 | `src/offscreen/offscreen.ts`、`src/content/contentKernel.ts` または `src/utils/pageContentPipeline.ts` |
| 06 | `entrypoints/options/index.html`、`src/dashboard/settings/aiSummaryCleansingSettingsV2.ts`、`src/utils/aiSummaryCleaner/presets.ts`（新規）、`_locales/*/messages.json` |
| 07 | `src/utils/storage/types.ts`、`src/content/contentKernel.ts`、`entrypoints/popup/index.html` |
| 08 | `src/utils/storage/types.ts`、`entrypoints/popup/`、`src/utils/piiSanitizer.ts`、`src/dashboard/` |
| 09 | `test/corpus/`（新規）、`scripts/check-cleansing-corpus.mjs`（新規）、`package.json` |
| 10 | `src/utils/contentExtractor/whitelistAdapters.ts`、`src/background/ai/`、`scripts/generate-whitelist-adapter.mjs`（新規） |
| 11 | `src/utils/contentExtractor/types.ts`（`ExtractResult`）、`src/utils/contentExtractor/index.ts`、`src/dashboard/cleansingStatsView.ts` |
| 12 | `src/utils/aiSummaryCleaner/patterns.ts` のみ |
| 13 | `src/content/contentKernel.ts`（`MutationObserver`）、`src/content/extractor.ts` |
| 14 | `src/utils/contentExtractor/types.ts`、`src/utils/contentExtractor/index.ts`、`src/utils/contentExtractor/cleansedReason.ts`、`src/dashboard/cleansingStatsView.ts` |
| 15 | `src/utils/llmOutputGuard.ts`（新規）、`src/background/privacyPipeline.ts` または `src/background/pipeline/RecordingPipeline.ts`、`src/dashboard/historyEntryRow.ts` |

> 行番号は各 PBI 作成時点のもの。着手時に該当シンボルで再確認すること。

---

**出典**: ブログ 6.5（クレンジング）執筆時のコード読解メモ、`docs/blog-6_5/` 相当の記述、および 2026-08-30 の LLM 縮退出力の実観測（`diamond.jp` 記事 / ollama gemma3:1b）。
