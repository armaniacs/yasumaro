# バックログ一覧（iteration-2 実装 P1・残作業）

- 作成日: 2026-09-20 (UTC)
- 対象: tag-cooccur 実装の残統合作業（PBI化）。P2以降の移植候補は iteration-1 計画の PBI（pbi/ の `2026-09-20-18-feat-markdown-sanitize-wasm.md` / `2026-09-20-19-feat-prompt-scan-wasm.md` / `2026-09-20-20-spike-export-serde-wasm.md`）が有効なため、本一覧では重複作成しない
- RICE スコアは本バックログ内の一貫性のための相対値であり、他のレポート・他の候補集合との絶対値比較は無意味

| 順位 | PBI | RICE（R/I/C/E） | 概要 |
|---|---|---|---|
| 1 | `pbi/2026-09-20-21-feat-tag-cooccur-panel-wiring.md` | 16.0（5/2/80%/0.5週） | パネル配線＋public配布（STAGED解除）。依存なし |
| 2 | `pbi/2026-09-20-22-chore-tag-cooccur-ci-gate.md` | 12.0（3/1/80%/0.2週） | CI同等性ゲートへの追加。PBI-21と独立（cmp有効化のみPBI-21後） |

## ロードマップ対応

- P1 tag-cooccur 本体: 実装済み（本 run）。残りは上表の2件
- P4 serde スパイク: `pbi/2026-09-20-20` が有効（P2 markdown-sanitize は撤去・P3 prompt-scan は不採用でいずれもアーカイブ済み）。本 run では未着手・PBI再作成なし
- 移植しないと判断した領域（暗号化・DOM走査・HMAC署名等）は PBI にしない。根拠（暗号化・DOM走査・HMAC署名・ublock 0.01ms級・小物の除外理由）は `pbi/00-INDEX.md` の本バッチセクションに要約記録
