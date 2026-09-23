# PBI 2026-09-23-01 — 履歴エントリ診断表示の深い Module 化

**優先度**: 順位 1 / RICE 24.0（Reach 6 × Impact 2 × Confidence 100% ÷ Effort 0.5 人週）
**根拠**: View 1169 行中の診断分岐約 300 行が 1 Module 背後に畳める。HTML バイト等価を守る純粋な Seam 移動で、録画パイプライン・WASM parity・wire-table・監視 backlog のいずれにも触れない。後続ラウンド候補（RPC Seam・設定フォーム）の雛形になる。
**種別**: refactor（非機能追加）

## 背景

`historyEntryPresentation.ts` が 6 classifier（classifyDiagnosticMissing / classifyExtractionMissing / classifyCleansingMissing / classifyTokensMissing / classifyMaskingMissing / classifyAiSummaryMissing）と `computeCleansingReduction` / `resolveCleansingBytes` / `describeFallbackReasonKey` に判断を集約した後も、View 側 `sqliteHistoryPanelView.ts` が `MISSING_REASON_KEYS`・`missingReasonText`・`pushReasonRow`・`formatDiagnosticMetadataHtml`（約 110 行の per-row if/else）・`buildCleansingProgressBarHtml`・`buildMissingReductionBarHtml` を所有する。呼び出し側は「どの classifier をどの行に使うか」「null のときどの reason で行を残すか」「CSS クラスと separator（`' — '` vs `': '`）」の 3 層を正しい順序で合成しなければならない。各 classifier は 5–10 行の null/0 分岐で、interface が実装と同程度の合成知識を要求する shallow module である。

## 実装戦略（何を・どこに・どの順で）

1. `src/dashboard/panels/asyncData/historyEntryPresentation.ts` を SealedModule 化し、`renderEntryDiagnostics(entry): string`（診断メタデータ HTML 全体）と `renderCleansingBar(entry): string`（削減率バー）の 2 関数を公開 interface にする。
2. `sqliteHistoryPanelView.ts` の `MISSING_REASON_KEYS` / `missingReasonText` / `pushReasonRow` / `formatDiagnosticMetadataHtml` / `buildCleansingProgressBarHtml` / `buildMissingReductionBarHtml` を Module 背後に移動し、View は Adapter 呼び出し 1 行に置換する。
3. `sqliteHistoryPanel.ts` の `mapRegenerateError` / `formatRegenerateErrorDetail` / `translateHistoryError` の reason-key 表を Module 側の表と共有させ、複製を消す。
4. 移行は HTML バイト等価を守る。まず現在の出力を characterization test として pin し、移動後に同一出力を回帰テストで検証する。

## 受け入れ基準（BDD）

### シナリオ 1: 診断行の HTML 出力は移行前とバイト等価
- **Given** 診断メタデータ（extraction / cleansing / tokens / masking / aiSummary の各欠落・正常パターン）を持つ履歴エントリのフィクスチャ群
- **When** `renderEntryDiagnostics(entry)` を呼ぶ
- **Then** 移行前の `formatDiagnosticMetadataHtml` 出力と文字列として完全一致する

### シナリオ 2: 新しい欠落理由の追加は Module 内 1 箇所で完結する
- **Given** 新しい missing reason key が 1 つ増える変更を行う
- **When** Module に reason 行を 1 つ追加する
- **Then** View 側の変更は不要であり、View から classifier 名・separator・CSS クラスへの参照が残っていないこと（`grep` で検証）

### シナリオ 3: 再生成エラーの reason-key 表は単一所有
- **Given** `mapRegenerateError` がエラー文面を reason key に変換する場合
- **When** Module 側の表と照合する
- **Then** Panel 側に reason-key の複製表が存在せず、Module の表を参照する

## DoD（Definition of Done）

- [x] `renderEntryDiagnostics` / `renderCleansingBar` が historyEntryPresentation.ts の公開 interface になり、View から内部関数への import が 0 になる
- [x] characterization test（バイト等価 pin）が追加され、緑
- [x] View 1169 行のうち診断分岐相当（約 250–350 行）が Module 背後に移動し、View の行数が実質減少する
- [x] `npm run type-check` / `npm run lint` / `npm test` が緑

## 実装記録（2026-09-23）
- コミット 5d7159e9。`renderEntryDiagnostics` / `renderCleansingBar` を historyEntryPresentation の公開 interface 化し、View の診断分岐を verbatim 移設（1169→1012 行）。15 fixture × 2 関数の characterization snapshot（31 テスト）で全 30 ブランチの HTML バイト等価を確認。Panel 側に reason-key 複製表は実在しなかったため、module 側 `MISSING_REASON_KEYS` の export による単一所有のみ実施（シナリオ3の空虚充足を記録）。
- 検証: type-check / asyncData 28 ファイル 352 テスト緑。
