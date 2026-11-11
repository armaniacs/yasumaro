# 台帳: 大局的改善ラウンド 2026-11-11 Round 1 (holistic-1111)

出所: holistic-code-review 並走スキャン (SoC・堅牢性・拡張性 3テーマ + 前回台帳送り1件)。
DRYスキャンは継続中のため Round 2 に回す。前台帳は書き換えない。NNは本日01起番。
検証コマンド: `npm run type-check` / `npm run lint` / `npm test` / `npm run build`。
アーカイブ先: `dev-docs/archived/pbi/`。

## RICE採点表

| 順 | ID | 候補 | 種別/規模 | R | I | C | E | RICE | 依存 |
|----|----|------|-----------|---|---|---|---|------|------|
| 1 | S1 | AI要約カスケードの取り違え・診断喪失 | fix/M | 6 | 2 | 0.8 | 3 | 3.2 | - |
| 2 | C1 | View⇔配線の値import循環解消 | refactor/S | 3 | 1 | 1.0 | 1 | 3.0 | - |
| 3 | S2 | ログ経路の分散・二重化の一本化 | refactor/S | 5 | 1 | 0.8 | 2 | 2.0 | - |

## 最終実行順 (NN)

純RICE降順そのまま。逸脱なし。`01`(S1)→`02`(C1)→`03`(S2)。
3件とも触るファイルが重ならないため同一バッチ並列 (ファイル排他・統合側がgit/INDEX/台帳を独占)。

## 依存マップ

なし (01: background/ai配下 / 02: dashboard panels sqliteHistory配下 / 03: logger・wasmHybrid・privacy・issueReport)。

## 台帳送り (今回対象外)

- sqliteHistoryModel肥大 + lifecycle ring迂回 (SoCテーマ3): 規模L・境界整理が必要なため Round 2 以降で分割して再評価 (再検討トリガー: Round 2レビュー時)。
- DRYスキャン結果: 到着後に Round 2 候補として列挙・採点する。
- `2026-11-08-18-backlog-default-doh.md`: 着手禁止ゲート付きのため駐留継続。
- 旧バックログの未チェック項目: 次回以降に再評価 (本ラウンドでは触らない)。

## DoD反映漏れ棚卸し結果

- `git status` クリーン、アーカイブ重複なし (pbi直下とdev-docs/archived/pbi/で同名なし)。
- pbi直下の `[ ]` は台帳送り・駐留・旧バックログの記録であり、新規実装の反映漏れなし。

## 統合修正の記録 (最終ゲートで検出)

- 最終ゲートのフルスイートで6失敗+未処理エラー2件。いずれも03の意図した振る舞い変更 (console+addLog二重発射→単一seam) への既存テスト未追従。
- `hybridWasmContract` / `tagCooccurrenceHybrid` / `tagCooccurrenceHybrid.probe-retry`: console.warnピンをseamピン (logWarn×1 + console無出力) に更新。addLog形状ピンに `_errorCode` / `_source` を追加。
- `issueReportLink.wire` / `issueReportLink.reentrancy`: 不完全なcoreモック (getLogsのみ) をimportOriginal spreadに修正し未処理拒否を解消。
- いずれも実装側の変更なし (テスト側の追従のみ)。
