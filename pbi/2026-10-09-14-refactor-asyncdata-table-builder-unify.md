# asyncData パネル内の表ビルダー双子 2 組の統合（refactor）

## 1. タイトル + 種別

- **タイトル**: `domainAnalysisPanel` と `timeHeatmapPanel` の、構造がほぼ一致する表描画関数ペア（2 組）を、cell 描画をコールバック化した単一ビルダーに統合する
- **種別**: refactor（挙動不変・重複削減のみ）
- **見積もり**: 1.5 SP

## 2. 優先度

- **優先度**: 順位 14
- **RICE**: R3 / I1 / C1.0 / E1.5 → **2.0**
- **根拠**:
  - asyncData の panel pattern（composition root / lifecycle / notices）は徹底適用済みで、この粒度の表ビルダー重複だけが未統合。列追加・a11y 修正が双子両方に必要になる
  - Impact は中（重複削減・規範化）、Confidence 1.0（構造が 95% 一致を実読確認）。Reach は同系パネルの改修頻度（四半期程度）
- **依存**: **なし**

## 3. ユーザーストーリー

**asyncData パネルの保守担当者として**、表描画が 1 つのビルダーに統合されていてほしい。なぜなら、95% 一致の双子が残っていると、列追加や `th scope=row` などの a11y 修正が片方だけに適用されるドリフトが起きるから。

## 4. 背景

同一ファイル内に構造が 95% 一致する表描画関数のペアが 2 組あり、列追加・a11y 修正が両方に必要になる。

該当箇所（全 file:line 検証済み）:

- `src/dashboard/panels/asyncData/domainAnalysisPanel.ts:73-98`（`renderDomainRows`）と `:100-114`（`renderUrlRows`）— `tr` / nameCell（`th scope=row`）/ `countCell(String(row.count))` の組立が同一で、name cell の button/text のみ差分。`resetOutput`（`:125-128`）も両 body の二重クリア
- `src/dashboard/panels/asyncData/timeHeatmapPanel.ts:144-185`（`buildHeatmapTable`）と `:187-222`（`buildNumericTable`）— caption・thead（corner th + 時間ループ `:154-159` vs `:197-202` は同一）・tbody の weekday 行ヘッダ（`:164-169` vs `:207-212` も同一）、`td` の描画のみ差分

改善案: domainAnalysis は `renderRankRows(body, rows, renderNameCell)` 1 つに、timeHeatmap は `buildTable(grid, captionKey, renderCell)` 1 つに統合する（cell 描画をコールバックで切替）。host の null-check（guard）は `resetOutput`/`isReady` の現位置に保持し、生成 DOM は同一。挙動不変。

## 5. BDD シナリオ

### シナリオ 1: domainAnalysis の行描画が単一ビルダーになる

```gherkin
Given domainAnalysisPanel に renderRankRows(body, rows, renderNameCell) が存在する
When ドメイン別と URL 別の両ビューの行を描画する
Then 両ビューが renderRankRows を呼び、name cell の描画のみコールバック差で切り替わること
And resetOutput の両 body クリアが単一経路に統合されていること
```

### シナリオ 2: timeHeatmap の表描画が単一ビルダーになる

```gherkin
Given timeHeatmapPanel に buildTable(grid, captionKey, renderCell) が存在する
When ヒートマップ表と数値表を描画する
Then caption・thead（corner th + 時間ループ）・weekday 行ヘッダの構造が単一実装から生成されること
And td の描画のみコールバック差で切り替わること
```

### シナリオ 3: 生成 DOM が現行と同一である

```gherkin
Given 統合前後で同じ入力データを与える
When 各パネルの表を描画する
Then 生成される DOM 構造（要素種別・属性・テキスト・順序）が現行と同一であること
```

## 6. 受け入れ基準

- [ ] `domainAnalysisPanel.ts` の `renderDomainRows`/`renderUrlRows` が cell 描画コールバック付きの単一ビルダーに統合され、`resetOutput` の二重クリアが単一経路になっている
- [ ] `timeHeatmapPanel.ts` の `buildHeatmapTable`/`buildNumericTable` が cell 描画コールバック付きの単一ビルダーに統合されている
- [ ] 生成される DOM（要素種別・`th scope=row` 等の属性・テキスト・順序）が現行と同一である
- [ ] `resetOutput`/`isReady` の null-check（guard）が現位置に保持されている
- [ ] 既存の両パネルテストが無変更で green である

## 7. テスト戦略

1. **生成 DOM の golden pin 先行**: 統合前に各パネルの描画結果（DOM 構造）を pin するテストが既存であれば確認し、無ければ最小の golden を追加してから統合する
2. **既存パネルテストの green 維持**: `domainAnalysisPanel` / `timeHeatmapPanel` の既存テストを無変更で通過させる
3. **validate green**: `npm run validate`（type-check + test）で全体通過を確認する

## 8. 見積もり

**1.5 SP** — 2 ファイル・4 関数の統合と golden pin の確認。ロジック変更なし、影響範囲は asyncData の 2 ファイル。

## 9. DoD

- [ ] 受け入れ基準 5 件すべて充足
- [ ] 生成 DOM の golden pin が green（統合前後で同一）
- [ ] 既存の両パネルテストが無変更で green
- [ ] `npm run validate`（type-check + test）が green
- [ ] 外部挙動不変（生成 DOM が現行と同一）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 14（R3 / I1 / C1.0 / E1.5 → 2.0）
- 依存: なし
