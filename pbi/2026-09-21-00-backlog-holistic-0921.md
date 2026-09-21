# バックログ: 大局的コード改善 holistic-0921 (2026-09-21)

4観点（DRY / SoC / 拡張性 / 堅牢性）の並列サブエージェント調査 + 統合側による全指摘の実コード裏取りで抽出した15候補を RICE 採点して PBI 化。ユーザー確認は2回（候補リスト・最終順位）実施済み。差分スコープ: 過去ラウンド（holistic-0918 a/b/c・archloop・arch-review-0917・review-fixes-0919・archreview-0920・rust-wasm-0920）で閉じたテーマは再レビューせず、進行中 PBI（13/14/16/2026-09-19-08）も本ラウンド対象外（ユーザー裁定: 後日 autonomous-task-closer に委ねる）。

## 採点

共通前提: Reach = 今後1年の保守作業での関与頻度(相対 1-10) / Impact = 3実害・2大きい・1中・0.5小 / Confidence = 裏取り度 / Effort = 週。全候補を同一基準・同一前提で比較。

| 順位 | PBI | 候補 | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 1 | [2026-09-21-02](2026-09-21-02-fix-persite-overrides-lock.md) | perSiteOverrides の raw set + `catch {}` 解消 | 4 | 3 | 0.8 | 0.5 | **19.2** |
| 2 | [2026-09-21-03](2026-09-21-03-refactor-url-guards-ssot.md) | urlUtils 双子（isSecureUrl・normalizeUrl）の SSOT 委譲 | 4 | 2 | 1.0 | 0.5 | **16.0** |
| 3 | [2026-09-21-04](2026-09-21-04-fix-port-validation-delegate.md) | ポート検証の validateObsidianPort 委譲 | 3 | 2 | 1.0 | 0.5 | **12.0** |
| 4 | [2026-09-21-05](2026-09-21-05-refactor-cleansing-key-derivation.md) | クレンジング鍵の presets/restorable 派生化 | 5 | 3 | 1.0 | 1.5 | **10.0** |
| 5 | [2026-09-21-06](2026-09-21-06-refactor-utils-background-edges.md) | utils→background 逆依存解消（auditLog・aiModelKey） | 4 | 2 | 1.0 | 1.0 | **8.0** |
| 6 | [2026-09-21-07](2026-09-21-07-fix-issue-report-reentrancy.md) | issueReport の再入 guard + エラーハンドリング | 2 | 1 | 1.0 | 0.25 | **8.0** |
| 7 | [2026-09-21-08](2026-09-21-08-fix-idle-scheduler-prune.md) | IdleScheduler の発火後 id 除去 | 4 | 0.5 | 1.0 | 0.25 | **8.0** |
| 8 | [2026-09-21-09](2026-09-21-09-fix-hybrid-probe-retry.md) | hybrid プローブの sticky-false 是正 | 3 | 1 | 1.0 | 0.5 | **6.0** |
| 9 | [2026-09-21-10](2026-09-21-10-refactor-provider-constructor-ritual.md) | プロバイダ構築儀式の共通化 | 3 | 1 | 1.0 | 0.5 | **6.0** |
| 10 | [2026-09-21-11](2026-09-21-11-fix-messaging-typed-senders.md) | messaging 型付きセンダー採用 + protocol SSOT 直参照 | 3 | 1 | 1.0 | 0.5 | **6.0** |
| 11 | [2026-09-21-12](2026-09-21-12-refactor-export-date-ssot.md) | エクスポート日付・タグ分解の SSOT 化 | 3 | 2 | 0.8 | 1.0 | **4.8** |
| 12 | [2026-09-21-13](2026-09-21-13-refactor-provider-domain-ssot.md) | プロバイダドメイン SSOT 統合（5リスト→派生） | 5 | 2 | 0.8 | 2.0 | **4.0** |
| 13 | [2026-09-21-14](2026-09-21-14-refactor-catalog-ui-branches.md) | catalog UI の gemini 分岐を catalog フィールド化 | 2 | 1 | 1.0 | 0.5 | **4.0** |
| 14 | [2026-09-21-15](2026-09-21-15-refactor-provider-factory-registry.md) | createProviderStrategy の factory registry 化 | 2 | 1 | 0.8 | 0.5 | **3.2** |
| 15 | [2026-09-21-16](2026-09-21-16-refactor-page-content-pipeline-decouple.md) | pageContentPipeline の PageState 値 import 解消 | 3 | 1 | 0.8 | 1.0 | **2.4** |

## 実行順の逸脱理由（同点時の tie-break）

- 5位 C3 = 6位 C7... ではなく C3=C12=C13 (8.0): リスク軽減効果順 — 層構造リスク（モジュール読み込み時 singleton）> unhandled rejection > メモリ微小増加
- C10=C7=C9 (6.0): 現時点の実害の有無 — C10 は現在進行形の perf 劣化、C7/C9 は予防
- C1=C14 (4.0): 同一ファイル群（providerCatalog.ts）の順序依存で C1 を先
- **注意**: 順位4の C2 は「実害が既に発生している唯一の候補」（バックアップ復元で4フラグ欠落）。RICE 順は維持するが、着手タイミングの観点で最優先扱いにして差し支えない

## 依存マップとバッチ計画（ファイル排他・同一ディレクトリ戦略）

- **バッチ1（5並列）**: 02 (perSiteOverrides) / 03 (urlUtils・headerDetector) / 04 (fieldValidation) / 05 (presets・restorableSettings) / 08 (contentKernel)
- **バッチ2（5並列）**: 06 (auditLog・aiModelKey) / 07 (issueReportLink) / 09 (tagCooccurrenceHybrid) / 10 (OpenAI・Gemini・ProviderStrategy) / 12 (exportLogsService・markdownExport・connectionTests)
- **バッチ3（直列チェーン・providerCatalog.ts 共有）**: 13 → 14 → 15
- **バッチ4（2並列）**: 11 (privacyConsent・encryptionSession・messaging/types) / 16 (pageContentPipeline・pageState) — 16 は 08 と contentKernel.ts が重複するためバッチ1完了後
- 各バッチ後に統合検証: `npm run type-check` → `npm run lint` → `npm test` → `npm run build`

## 既存進行中 PBI の扱い（ユーザー裁定 2026-09-21）

- 2026-09-20-13（hybrid runtime）/ 14（共有 Rust crate）/ 16（wire table 拡張）/ 2026-09-19-08（記録判定純粋関数化）: 本ラウンド対象外。後日 `autonomous-task-closer` に委ねる
- 連携注記: PBI 09（probe 是正）は PBI 13（共有 runtime）が吸收する領域。09 の契約（失敗時再プローブ）を runtime 側が維持すること

## 台帳送り（実害未発生・再検討トリガー付き）

- **tagCooccurrence.ts の dashboard 配置**（純粋関数がエントリポイント配下。wasm/tag-cooccur と offscreen テストが cross-import）— 再検討トリガー: compute を offscreen/パイプラインへ移設する時（dedup offscreen 移設の再評価と同時）
- **Ollama 専用 Origin-strip 汎用化**（ollamaOriginRule + ollamaSettingsObserver が単一プロバイダ用 seam）— 再検討トリガー: 2つ目のローカルプロバイダーで CORS 対策が必要になった時

## 疑問の自律解決（なぜなぜ分析の要約）

- 「20ラウンド改善済みなのに為什麼残るか」→ (a) 新規コードパス（tag-cooccur・issue-report・per-site overrides は直近ラウンドの産物）が既存規律の適用外で生まれる (b) lint の LAYER1_FILES 未分類クラスが盲点 (c) derivation ルールが SSOT 直上の1層で再手書きされる（rules.ts 表化の成果が presets/restorable に伝播しなかった）
- 「なぜ復元欠落が実害化したか」→ Category-B 4ルール追加時に restorable spec の追記漏れ。表が2箇所（presets・restorable）に手写しされていたため網羅性テストが不在
- 「なぜ C1 が5リストに育ったか」→ CSP validator・manifest・urlWhitelist が別時期・別目的（fail-close・権限・録画判定）に個別成長し、中立行モデル（providerAllowlist）発明後に取り込み機会がなかった

## 実行結果（2026-09-21 完了）

- **全15件 実装・検証・コミット完了。** 統合検証: type-check PASS / lint 0 errors（既存 warning 21 増減なし）/ test 12,839 passed + 21 skipped（811 ファイル）/ build PASS
- バッチ実績: バッチ1（02/03/04/05/08 5並列）→ バッチ2（06/07/09/10/12 5並列。07 は停滞サブエージェントを統合側が引き取り実装）→ バッチ3（13→14→15 直列チェーン）→ バッチ4（11/16 2並列）
- コミット: 02 aec50dc / 03 e77dcd0 / 04 2fc5cd6 / 05 68ff4344 / 08 7fd06c17 / 06 9b9cbeb / 07 990978d / 09 e6057d7 / 10 162a613 / 11 3b8c9f9 / 12 94d554f / 13 33b555e / 14+15 03f1fc3（providerCatalog.ts 共有のため統合）/ 16 78d282f8
- 実装中の発見: (a) PBI 05 の「32鍵」は実数33鍵（台帳表記は執筆時の誤記・実装は実テーブルから派生し問題なし）(b) PBI 02 の raw set は contentKernel 読み取り経路から冗長と実証 (c) PBI 13 の WHITELIST 旧順序は単一行順では再現不能（Set/includes/sorted UI のため実害なし・golden を set-equality に緩和）(d) lint の vitest/valid-expect エラー13件（expect 第2引数）を統合側で修正
- 残務の統合側処理: aiModelKey shim 削除、未使用 import 削除（PBI 11 の sender 化副産物）、optionBuilder 型 import の新 SSOT 向け直（PBI 16）
- 進行中 PBI（13/14/16/2026-09-19-08）の autonomous-task-closer 委託は未実施 — 次ラウンドで実施すること

## 再検討結果（2026-09-22・差分スコープ再レビュー）

新規候補ゼロのため新台帳は作らずここに追記する。

- 差分スコープ: holistic-0921 完了コミット 78d282f8 以降（src/entrypoints の非テスト変更約 50 ファイル）。utils から上位層への逆依存は 0 件。
- 堅牢性の疑いは実コードで棄却: `storageFallback.allocateIds` の read-modify-write は `insert`/`insertBatch` が同一 `this.mutex` 配下で呼ぶため直列化済み。`recordingTriggerManager` の raw set は単一キーの全置換で RMW ではない。
- 空 `catch {}` 6 箇所（PrivacyCache.clearSession・settingsMigration・aiSummaryCleaner/helpers・settingsPipeline・sqliteHistoryModel listener notify・aiSummaryCleansingPanel）は best-effort 経路で実害が確認できず、台帳送り。再検討トリガー: 同経路で握りつぶした失敗が原因の不具合報告が出た時。
- 台帳送りのトリガー再評価: tagCooccurrence の dashboard 配置（compute の offscreen 移設なし）・Ollama Origin-strip 汎用化（LM Studio は ALLOWED_LOCALHOST_PORTS に 1234 を持つが CORS 対策の必要性は未確認）とも未発火。据え置き。
- 進行中 PBI: 2026-09-20-17/21/22（実機確認と PR レビュー待ち）、2026-09-05-32（ADR-014 ゲート 2026-12-17 まで着手禁止）はいずれもユーザー側の確認・時期待ちで、自律実装で閉じられるものはない。
