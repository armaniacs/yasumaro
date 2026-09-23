# PBI 2026-09-23-05 — 記録可否判定 gate 群の表駆動化（録画パイプライン）

**優先度**: 順位 5 / RICE 7.5（Reach 7 × Impact 1 × Confidence 80% ÷ Effort 0.75 人週）
**根拠**: 同一 precedence（domain→permission→trust→privacy→duplicate）が 4 箇所で再記述され、新 gate 追加が 4 点編集になる。表駆動化で順序知識を 1 表に集約し、step 毎の結合テストを verdict マトリクスに畳める。
**種別**: refactor（非機能追加）

## 背景

`recordingDecision.ts`（verdict 純粋関数群 + `RECORDING_DECISION_ORDER`）と、各 30–80 行の薄皮 step（checkDomainFilterStep / checkPermissionStep / checkTrustDomainStep / checkPrivacyHeadersStep / checkDuplicateStep）と、content 側 `visitGate.ts` と popup 側 `recordSession.ts` の `isRecordable` 連携が、同一 precedence を別々に再記述している。理解には 5 ファイルの bounce が必要で、新 gate 追加は decide＋step＋index＋orchestrator 配線の 4 点編集になる。

## 実装戦略

1. `recordingDecision.ts` を唯一の Seam に昇格させ、`evaluateGates(context): GateVerdict` を公開する。各 gate は `{ name, extractInputs(ctx), decide }` の表行になる。
2. 5 step を表の Adapter（または表から生成）に落とし、`steps/index.ts` の手書き配列を表から導出する。
3. content `visitGate.ts` と popup `recordSession.ts` の `isRecordable` 連携は同一 verdict 表を参照する（popup/content から background を import できない制約があるため、verdict 表は中立層（utils 系または messaging 層）に配置して 3 経路から参照する）。
4. FATAL 短絡の語義（最初に拒否した gate が表示される）と precedence の順序は変更しない。privacy pre-decision 統合（b6a7e0f4）・監視 backlog（2026-09-22-11）の領域には触れない。

## 受け入れ基準（BDD）

### シナリオ 1: 新 gate の追加は表 1 行で完結する
- **Given** 新しい記録可否 gate（例: 将来の quota gate）を追加する
- **When** gate 表に `{ name, extractInputs, decide }` の行を 1 つ追加する
- **Then** step・index・orchestrator の個別編集なしで、SW pipeline・content VisitGate・popup isRecordable の 3 経路に反映される

### シナリオ 2: precedence と FATAL 短絡語義は不変
- **Given** 複数 gate が同時に拒否する入力
- **When** `evaluateGates(context)` を呼ぶ
- **Then** 現行と同一の順序（domain→permission→trust→privacy→duplicate）で最初に拒否した gate の verdict が返る

### シナリオ 3: content/popup は同一表を参照する
- **Given** content 側 VisitGate と popup 側 isRecordable
- **When** 各経路の判定結果を比較する
- **Then** 3 経路で precedence の複製表が存在せず、中立層の 1 表を共有する

## DoD（Definition of Done）

- [ ] `evaluateGates` が唯一の Seam になり、step 群が表駆動になる
- [ ] precedence 複製（content/popup 側）が消え、中立層の 1 表に統合される
- [ ] 既存の録画判定テストが無修正で緑（語義不変の証明）
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑
