# 台帳: 大局的改善ラウンド 2026-11-07 差分 (holistic-1107b)

出所: 差分ラウンド大局的レビュー報告書(前回閉鎖テーマは対象外、未精査領域のみ)。
前台帳 `pbi/2026-11-07-00-backlog-holistic-1107.md` は書き換えない。NNは同日継続採番 (10〜)。
検証コマンド: `npm run type-check` / `npm run lint` / `npm test` / `npm run build`。
アーカイブ先: `dev-docs/archived/pbi/`。

## RICE採点表

| 順 | ID | 候補 | 種別/規模 | R | I | C | E | RICE | 依存 |
|----|----|------|-----------|---|---|---|---|------|------|
| 1 | D2 | recordingOutcome void 2箇所集約 | fix/S | 6 | 2 | 0.8 | 2 | 4.8 | - |
| 2 | D1 | validator alias置換1行 | fix/S | 2 | 1 | 1.0 | 1 | 2.0 | - |
| 3 | D3 | purgeRunner/parityPredicate機械分離 | refactor/M | 3 | 2 | 0.8 | 5 | 0.96 | - |
| 4 | D4 | Viewダイアログ群切り出し | refactor/M | 4 | 1 | 0.8 | 5 | 0.64 | - |
| 5 | D5 | cleanser header実行段階追記 | docs/XS | 1 | 0.5 | 1.0 | 1 | 0.5 | - |

## 最終実行順 (NN)

純RICE降順そのまま。逸脱なし。`10`→`11`→`12`→`13`→`14` (ID順 D2,D1,D3,D4,D5)。

## 依存マップ

なし (5件とも触るファイルが重ならない。D2: pipeline/recordingOutcome、D1: messaging/validators、D3: offscreen builder、D4: dashboard view、D5: utils cleanser header)。

## 台帳送り (今回対象外)

- 別枠3件: テーマ1 grep-only 2件精査 (要確認のため調査PBI化を見送り、次回レビューで再評価) / Model 1184行構造 (未読のため次回) / cap乖離仕様化 (調査不足のため次回)。
- 旧バックログ6件: 進行中として残す (次回 holistic で再評価)。
- `2026-11-07-backlog-ai-model-review.md` 未チェック3件: 時限ゲート (2027-01)。
- 除外候補なし。

## DoD反映漏れ棚卸し結果

- アーカイブ重複なし。前回9件は全件アーカイブ済み・INDEX反映済み。
- 新規反映漏れなし。
