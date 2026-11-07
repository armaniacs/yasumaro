# 台帳: arch-delivery-loop 2026-11-07 (archloop-1107)

出所: Phase 0 診断レポート (`/tmp/architecture-review-20261107.md`)。診断ドメインはモジュール深度・seam・約束事乖離 (holistic系と非重複)。約束事スポットチェックは乖離なし。
前台帳 (holistic-1107 / holistic-1107b) は書き換えない。NNは同日継続採番 (15〜)。
検証: `npm run type-check` / `npm run lint` / `npm test` / ビルド (`make clean test` が最終)。プライバシー保証を壊さない (外部送信・鍵復号の移動なし)。
アーカイブ先: `dev-docs/archived/pbi/`。

## RICE採点表

| 順 | ID | 候補 | 種別/規模 | R | I | C | E | RICE | 依存 |
|----|----|------|-----------|---|---|---|---|------|------|
| 1 | E1 | dashboard-sqlite taxonomy単一所有者 | refactor/M | 6 | 2 | 1.0 | 5 | 2.4 | - |
| 2 | E2 | 画面state単一所有者化 | refactor/L | 4 | 2 | 0.8 | 8 | 0.8 | - |
| 3 | E4 | pending-row共有レンダラー | refactor/M | 4 | 1 | 0.8 | 5 | 0.64 | E2完了後 (Panel共有のため) |
| 4 | E3 | collection v1 sunset+実行集約 | refactor/L | 3 | 1 | 0.8 | 8 | 0.3 | E2完了後 (Model共有のため) |
| 5 | E5 | claim取得をorchestrator内へ (要確認込み) | refactor/M | 3 | 1 | 0.5 | 5 | 0.3 | - |

## 最終実行順 (NN)

RICE降順。逸脱: E3/E5同点は安全側 (枯れ経路削除のE3を先、SpeculativeのE5を後)。E4・E3はE2と同一ファイル群のため直列 (E2→E4→E3の順で消化)。
`15`(E1) → `16`(E2) → `17`(E4) → `18`(E3) → `19`(E5)。E1とE5は初回バッチで並列可。

## 依存マップ

- E4・E3 は E2 とファイル共有 (`sqliteHistoryModel.ts` / `sqliteHistoryPanel.ts`) のため E2完了後に直列。
- E1 (messaging) と E5 (background) は他と排他。

## 台帳送り

なし (候補5件すべてPBI化)。

## バッチ計画

- Batch 1 (並列): E1 + E5。
- Batch 2: E2 (単独)。
- Batch 3 (並列): E4 + E3。
- 境界検証は `npm run validate:fast`、最終は `make clean test`。
