# 2026-09-23 arch-delivery-loop ラウンド台帳（archloop-0923）

Phase 0 診断（サブエージェント探索 + HTML レポート: `$TMPDIR/architecture-review-20260923-0405.html`）→ Phase 1 RICE スコアリングの記録。実装対象は順位 1〜5（RICE 降順、依存なし・並行可能だが直列で消化）。順位 6〜7 は未採用候補として live 台帳（`pbi/2026-09-05-00-backlog-future.md`）へ記録。

## RICE スコア表

| 順位 | PBI | Reach | Impact | Confidence | Effort(人週) | RICE | 判定 |
|------|-----|-------|--------|-----------|--------------|------|------|
| 1 | 01 履歴エントリ診断表示の深い Module 化 | 6 | 2 | 100% | 0.5 | 24.0 | 実装 |
| 2 | 02 SQLite RPC wire-table Seam 深化 | 8 | 2 | 80% | 0.75 | 17.1 | 実装 |
| 3 | 03 設定フォーム記述子表化＋SSOT 委譲 | 7 | 2 | 80% | 1.0 | 11.2 | 実装 |
| 4 | 04 runHybrid 汎用化（政策 Adapter 化） | 5 | 1 | 80% | 0.5 | 8.0 | 実装 |
| 5 | 05 記録可否判定 gate 群の表駆動化 | 7 | 1 | 80% | 0.75 | 7.5 | 実装 |
| 6 | ProviderSlotRunner 化（AI スロット走査） | 8 | 1 | 50% | 1.0 | 4.0 | live 台帳 |
| 7 | queryPlan Interface 圧縮 | 6 | 0.5 | 50% | 1.0 | 1.5 | live 台帳 |

同点のタイブレーク規約（リスク軽減 → 緊急性）は不使用（同点なし）。

## 依存グラフ

```
01 ──┐（雛形パターン: 判断×表示の分離 → 02/03 に適用可能だがハード依存なし）
02 ──┤
03 ──┼─ すべて独立（並行可。実装は RICE 降順の直列）
04 ──┤
05 ──┘
```

ハード依存なし。06 は「直近の VULN-001/002 修正の落ち着き」を条件に live 台帳へ、07 は「統一済みで残 payoff 小」を理由に live 台帳へ。

## 5 Whys サマリー

- **01**: なぜ View に診断分岐が残るのか → classifier 集約後に「合成知識」（どの行・どの separator・どの CSS）が残った → なぜ合成知識が呼び出し側にあるのか → 診断行の「見え方」を HTML 化する工程が誰の所有か未定義だった → 解: `renderEntryDiagnostics(entry): string` を interface に、HTML 化工程を Module 背後に。
- **02**: なぜ 30 個の named ラッパーが shallow になるのか → wire-table が descriptor を持つだけの表で、encode/decode/retry の語義が行と runner と Service に分散 → 解: wire-table を行単位で語義を所有する真の Seam に昇格、ジェネリック `call(op, payload)`。
- **03**: なぜ範囲リテラルが UI に複製されるのか → 検証の SSOT 委譲が obsidian/port 系だけ済んでいて token 系が未着手 → なぜ未着手か → フィールド単位の記述子という所有箇所が無かった → 解: 記述子表 SSOT + `aiLimits.validateMaxTokens` 委譲。
- **04**: なぜ 4 ファイルに骨格がミラーされるのか → runtime が「機構」を所有した時点でラウンド終了し、「骨格の所有」まで手が届かなかった → 解: `runHybrid` 政策 Adapter 化（機構と政策の分離を完了させる）。
- **05**: なぜ precedence が 4 箇所に再記述されるのか → verdict 純粋関数化で「判定」は集約したが「順序と step 薄皮」の所有が未定義 → 解: `evaluateGates(context)` 唯一 Seam + gate 表行、content/popup は中立層の同一表を参照。

## 実装記録（Phase 2 完了後）

Phase 2 の実行順: 01 → 02 → 03 → 04 → 05（RICE 降順・依存なし）。完了済み — 結果は各 PBI（dev-docs/archived/pbi/ の実装記録節）と `pbi/00-INDEX.md` のアーカイブ履歴（2026-09-23 ラウンド）に記載済み。
