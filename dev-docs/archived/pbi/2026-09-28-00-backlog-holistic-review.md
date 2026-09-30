# Backlog: 大局的コードレビュー 2026-09-28 の改善 PBI 群

大局的コードレビュー（holistic-code-review skill 実行）の報告書から抽出した7候補を RICE 採点し、PBI 化した一覧。証拠の file:line は各 PBI に記載。レビュー報告書の全文は会話ログ参照。

## RICE スコア表（降順）

| 順位 | NN | 候補 | RICE | R/I/C/E | 依存 |
|---|---|---|---:|---|---|
| 1 | 24 | recordingTriggerManager の blob 読み化 + pin（fix） | 24.0 | 4/2/100%/0.25 | — |
| 2 | 25 | 死コード除去: migration.ts / storage.ts shim / trancoConsent chain / inMemoryTransport 移動（refactor） | 24.0 | 8/1.5/100%/0.5 | —（同点はリスク軽減効果で順位1を先行） |
| 3 | 26 | メッセージ契約 linkage + 未登録型 fallback 応答（fix） | 10.8 | 6/2/90%/1.0 | — |
| 4 | 27 | gate 順序 SSOT 一本化: ADR 裁定 + 実装（refactor） | 6.4 | 4/2/80%/1.0 | — |
| 5 | 28 | 既定値一本化 + permissionManager seam 統一 + clear() 経路（refactor） | 5.0 | 5/1/100%/1.0 | —（PBI 24 の姉妹。実害側は 24 が閉じる） |
| 6 | 29 | 送信 seam 集約 + リトライ判定の正規形集約（refactor） | 4.8 | 8/1.5/80%/2.0 | 26 の後に着手 |
| 7 | 30 | 層 edge 整備: protocol 値の中立層引き上げ + content reader + offscreen proof（refactor） | 4.0 | 5/1.5/80%/1.5 | — |

合計 8.25 SP。推奨バッチ: {24, 25} → {26, 27, 28} → {29, 30}。

## 個別 PBI

- [2026-09-28-24-fix-recording-trigger-threshold-blob-read.md](2026-09-28-24-fix-recording-trigger-threshold-blob-read.md)
- [2026-09-28-25-refactor-dead-code-removal-migration-shim.md](2026-09-28-25-refactor-dead-code-removal-migration-shim.md)
- [2026-09-28-26-fix-message-contract-linkage-fallback.md](2026-09-28-26-fix-message-contract-linkage-fallback.md)
- [2026-09-28-27-refactor-gate-order-ssot-unification.md](2026-09-28-27-refactor-gate-order-ssot-unification.md)
- [2026-09-28-28-refactor-defaults-centralization-seams.md](2026-09-28-28-refactor-defaults-centralization-seams.md)
- [2026-09-28-29-refactor-sender-seam-retry-normalization.md](2026-09-28-29-refactor-sender-seam-retry-normalization.md)
- [2026-09-28-30-refactor-layer-edge-cleanup.md](2026-09-28-30-refactor-layer-edge-cleanup.md)

## 対象外リスト

- ニッチ指摘（命名・フォーマット・単発バグの疑い）は PBI 化していない。file 単位レビューの領域であり、本ラウンドの対象外
- リトライ4系統の完全統合（回数・待機まで含む一本化）は PBI 29 のスコープ外とし、正規形集約（判定のみ）にとどめる
- E2E の実 SW-kill による復旧検証は本ラウンドの PBI に含めない（fault-injection 統合テストで代替する方針）
