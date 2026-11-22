# 台帳: 残存項目の再優先度付け leftover-reprioritize

2026-11-22 の既存 leftover / 継続項目の再優先度付け台帳。対象は実働9件。
PBI 新規作成は行わず、既存 PBI を参照して順位だけを確定する。
前提: omnibox-url-fallback は完了 (2026-11-16-02 アーカイブ済み)。
typescript-7 採用 (2026-09-26-12) は TS7 移行で解消済み。

## RICE 採点 (同一基準・同一前提)

非機能改善の目安で採点。holistic-1120 と同じ基準を使う。
Reach は今後1年の保守関与頻度 (相対 1-10)。
Impact は 3=実害解消 / 2=大きい / 1=中 / 0.5=小。
Confidence は 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=前提条件が残る。
Effort は SP。

| 順 | 候補 | R | I | C | E | RICE | 種別 | PBI |
|---|---|---|---|---|---|---|---|---|
| 1 | listen 共有ユーティリティ化 | 8 | 2 | 1.0 | 3 | 5.33 | refactor | [2026-11-21-01](2026-11-21-01-refactor-listen-shared-utility.md) |
| 2 | settings form binding 導入 | 8 | 2 | 0.8 | 5 | 2.56 | refactor | [2026-11-21-05](2026-11-21-05-refactor-settings-form-binding-adoption.md) |
| 3 | webhook export 要素取得の集約 | 4 | 1 | 1.0 | 3 | 1.33 | refactor | [2026-11-21-03](2026-11-21-03-refactor-webhook-export-element-consolidation.md) |
| 4 | parseIntOr 共有ユーティリティ化 | 3 | 0.5 | 1.0 | 2 | 0.75 | refactor | [2026-11-21-02](2026-11-21-02-refactor-parseintor-shared-utility.md) |
| 5 | ai-cleansing threshold 反復のループ化 | 3 | 0.5 | 1.0 | 2 | 0.75 | refactor | [2026-11-21-04](2026-11-21-04-refactor-ai-cleansing-threshold-loop.md) |
| 6 | utils フラット namespace 再編 | 8 | 2 | 0.5 | 8 | 1.00 | refactor | [2026-09-25-30](2026-09-25-30-refactor-utils-namespace-reorg.md) |
| - | OffscreenGateway archive 責務分割 (駐留) | 4 | 1 | 0.8 | 2 | 1.60 | backlog | [2026-09-25-29](2026-09-25-29-backlog-offscreen-gateway-archive-split.md) |
| - | wa-sqlite レガシー・サンセット (駐留) | 5 | 2 | 0.5 | 5 | 1.00 | refactor | [2026-09-05-32](2026-09-05-32-refactor-wasqlite-sunset.md) |
| - | sqliteHistoryModel 責務分割 残部 (駐留) | 6 | 2 | 0.6 | 8 | 0.90 | refactor | 台帳送り (次回 Model 変更時) |

根拠の要点:
- 01 listen は dashboard に7定義を確認。trustSettings のみ generic 版で既に drift あり。重複解消の実害根拠が強い。R8 I2 C1.0 E3。
- 05 form binding は `?.checked ?? false` / `?.value ?? ''` が約26件・約15ファイルに分散。波及が広い。R8 I2 C0.8 E5。
- 03 webhook は同一ファイル内の save/load 重複。範囲が閉じている。R4 I1 C1.0 E3。
- 02 parseIntOr は単一ファイル内の局所移動。単体価値は小さいが 04 と 08 の前提になる。R3 I0.5 C1.0 E2。
- 04 threshold は単一ファイル内の見た目改善。02 と同一ファイルのため連続実施が前提。R3 I0.5 C1.0 E2。
- 08 namespace は波及が最大だが規模が大きく確度が低い。小型の utils 追加 (01/02) の完了後に行う。R8 I2 C0.5 E8。
- 07 gateway は RICE 1.60 だが実害未確認で着手トリガー待ちのため駐留。
- 06 wasqlite は ADR-014 承認待ちのため駐留。
- 09 model 残部は Model 変更時トリガー待ちのため駐留。

## 実行順と逸脱理由

実行順は 01 -> 05 -> 03 -> 02 -> 04 -> 08。
02 -> 04 は同一ファイル (aiSummaryCleansingSettingsV2.ts) のため直列・連続。
01/02 の utils 追加が 08 の大規模再編より先 (後から再編すると移動が二重になるため)。
05 と 03 は独立で並列可。01 と 02/03/04/05 は触るファイル群が重ならないため並列可。
08 は大型のため単独バッチとし、最後に実施する。
スコア順では 08 (1.00) が 02/04 (0.75) より上だが、依存優先の原則で 02/04 を先にし 08 を最後に回す。
駐留3件 (07/06/09) はトリガー観測まで着手しない。

## 依存マップ

- 01 -> なし (src/utils/domListen.ts 新設 + 6ファイルから削除)
- 05 -> なし (settings 系に helper 適用。02/04 と同ファイルに触れる場合は直列化する)
- 03 -> なし (webhookExportSettings.ts のみ)
- 02 -> なし (src/utils/string.ts + aiSummaryCleansingSettingsV2.ts)
- 04 -> 02 (同一ファイルのため 02 の直後に実施)
- 08 -> 01/02 (小型 utils 追加の完了後に実施)
- 07 -> 着手トリガー待ち (実害確認または着手宣言)
- 06 -> ADR-014 承認待ち
- 09 -> Model 変更時トリガー待ち

## 駐留・対象外の扱い

- release-store-upload-failure (2026-11-16-01): 所有者の secrets / ストア側検証待ち。コード作業なし。
- ai-model-review (2026-11-07): 2027-01 四半期ゲート。時限のため今回の順位対象外。
- default-doh (2026-11-08-18): 明示的着手宣言まで実装禁止。駐留継続。
- defense-in-depth hardening (2026-09-22-11): 監視索引のみでコード変更なし。順位対象外。
- omnibox-url-fallback (2026-11-16-02): 完了済み。対象外。
- typescript-7 採用 (2026-09-26-12): TS7 移行で解消済み。対象外。

## 検証コマンド

- 型検査: `npm run type-check`
- lint: `npm run lint`
- テスト: `npm run test` (フルスイート)、ゲート: `npm run validate`
- ビルド: `npm run build`
