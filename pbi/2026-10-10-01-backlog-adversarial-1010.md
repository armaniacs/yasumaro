# 2026-10-10 adversarial review バックログ台帳（adversarial-1010）

## 出所

- adversarial-code-review skill による全体レビュー（作業ツリーcleanのため差分ではなく高リスク3領域を対象）。
- hacker + maintainer の 2 視点を 6 agents で発見し、独立検証（5並列の反証裏取り）を実施。
- REFUTED 分（リダイレクト漏洩、DNSリバインディング、senderTrust、confirmToken、GET_CONTENT盗読、alarm誘発、UI/CAS/Mutex等）は起票対象外。
- 保守バッチ約130件は個別反証未実施のため不採用。
- 実残 3 件を PBI 14–16 に起票した。本台帳は RICE 採点・依存順・到達可能性証拠の SSOT。

## RICE 採点表（RICE 降順）

| 順 | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---|---|---|---:|
| 1 | [2026-10-10-14-fix-save-alreadyprocessed-pii-bypass.md](../dev-docs/archived/pbi/2026-10-10-14-fix-save-alreadyprocessed-pii-bypass.md) | fix | 6 | 3 | 1.0 | 0.5 | 36.0 |
| 2 | [2026-10-10-15-fix-sanitize-title-newline-injection.md](../dev-docs/archived/pbi/2026-10-10-15-fix-sanitize-title-newline-injection.md) | fix | 4 | 2 | 1.0 | 0.5 | 16.0 |
| 3 | [2026-10-10-16-fix-pii-long-token-scan-evasion.md](../dev-docs/archived/pbi/2026-10-10-16-fix-pii-long-token-scan-evasion.md) | fix | 3 | 2 | 0.9 | 2.0 | 2.7 |

RICE = R × I × C / E。値は各 PBI 内「見積もり」前の記載に基づく。

## 依存（実行順の制約）

- 3件とも編集ファイル非重複のため並列可（14: `recordRequestBuilder.ts` / 15: `markdownFormatter.ts` / 16: `piiSanitizer.ts`）。
- 実装順は RICE 順（14 → 15 → 16）を推奨。検証は `npm run validate` 一括。
- 既存テスト更新は 14 の `recordRequestBuilder.test.ts:17-19` 1件のみ。

## 到達可能性（reachability-verified evidence）

独立検証で file:line を確認済みの到達経路（詳細は各 PBI の「背景」セクション、統合時に目視再確認済み）:

- 14: SAVE_RECORD（popup dialog保存）から常に到達 — `recordingHandlers.ts:316-323` → `recordRequestBuilder.ts:73` → `privacyPipeline.ts:185-186,162-164`。既定 `masked_cloud`（`defaults.ts:68`）
- 15: 攻撃者制御`<title>`の記録で到達 — `markdownFormatter.ts:62-69,174`（validatorは長さのみ `validators.ts:512-517`）
- 16: 攻撃者制御ページ本文の長トークンで到達 — `piiSanitizer.ts:57-69,287,305,322`（node再現あり）

## 実装状況

| PBI | 状態 |
|---|---|
| 14 | 未着手 |
| 15 | 未着手 |
| 16 | 未着手 |
