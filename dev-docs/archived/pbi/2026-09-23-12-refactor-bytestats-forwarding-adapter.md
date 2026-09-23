# PBI 2026-09-23-12 — ByteStats 転送 Adapter（録画リクエスト builder の所有完成）

**優先度**: 順位 12 / RICE 16.0（Reach 5 × Impact 2 × Confidence 80% ÷ Effort 0.5 人週）
**根拠**: builder の Seam は既存で、新診断 field の 4 箇所同期という現在進行形の drift クラスを構造的に消す。VALID/MANUAL/SAVE/REGENERATE の乖離を型で防ぐ。
**種別**: refactor（非機能追加）

## 背景

`src/background/recordRequestBuilder.ts:37-184` が `RecordDiagnosticFields` interface を所有済みなのに、`recordingHandlers.ts` の 4 呼び出し側（VALID_VISIT :145-164 / MANUAL :279-295 / SAVE :334-352 / REGENERATE :422-443）が同一 8–14 field（`pageBytes` / `candidateBytes` / `originalBytes` / `cleansedBytes` / `aiSummary*`、`fallbackTriggered` / `fallbackReason` / `cleansedReason`）を `pickDefined` で手列挙する。新 field の追加は 4 箇所の同期編集になり、忘れた面は型エラーにならず analytics が黙って劣化する。重複面は約 50 行。

## 実装戦略

1. builder に `pickRecordDiagnostics(payload): RecordDiagnosticFields` を追加し、共有 byte/診断部分集合の抽出を 1 関数に集約する。
2. 4 呼び出し側を `buildRecordRequest('manual', { title, url, content, ...pickRecordDiagnostics(payload), skipAi, ... })` 形の spread 1 行にする。
3. どの field が束で運ばれるか・SAVE の `maskedCount: undefined` 除外は builder が所有する。`force` / `previewOnly` / `targetEntryId` は呼び出し側に残す。
4. `pickDefined` の undefined 除去語義は厳密に維持する。

## 受け入れ基準（BDD）

### シナリオ 1: 新 field の追加は 1 箇所で完結する
- **Given** 新しい診断 field の追加タスク
- **When** builder の表に 1 行を追加する
- **Then** 4 handler の個別編集なしで、全経路に転送される

### シナリオ 2: 4 経路の転送内容が一致する
- **Given** 同一ペイロードを 4 経路に流す
- **When** 各経路の診断部分を比較する
- **Then** 欠落・過剰がなく、SAVE のみ `maskedCount` を除外する

### シナリオ 3: 保存語義は不変
- **Given** 現行の録画ハンドラテスト群
- **When** Adapter 導入後に実行する
- **Then** 無修正で緑である

## DoD（Definition of Done）

- [ ] `pickRecordDiagnostics` が builder の公開 interface になり、4 箇所の手列挙が消える
- [ ] 新 field 追加が 1 行で済むことがテストで pin される
- [ ] 既存の録画ハンドラテストが無修正で緑
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
