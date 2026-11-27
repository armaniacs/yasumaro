# 台帳: 2026-11-27 VulnHunter セキュリティ監査ラウンド vulnhunt-1127 (7件)

## 概要

VulnHunter セキュリティ監査 (yasumaro_VULNHUNT_RESULTS_2026-11-27-190000、
GLM-5.3-Flash、ユーザー指定による現モデル継続) の発見 9 件 (脆弱性 6 + Code Quality 3)
に対応する修正ラウンド。exploit tests 16/16 PASS が脆弱挙動を現行コードで再現済み
(前提条件として全件が実コードに実在することを実測確認)。

- ブランチ: 1128a (main 先端 157669727 から作成、PR #218-220 分は含まない)
- 出所: yasumaro_VULNHUNT_RESULTS_2026-11-27-190000/{report.md, phase2b_output.md,
  phase3_output.md, phase3d_output.md} — file:line と fix strategies は実測済み
- PoC 6 件 + exploit tests 6 ファイル (16 tests) は VULNHUNT_DIR 配下に保存済み

## RICE 採点 (降順が実行順)

| PBI | R | I | C | RICE | SP | 逸脱理由 |
|---|---:|---:|---:|---:|---:|---|
| 02 VULN-004 リンク注入修正 | 4 | 3 | 1.0 | 12.0 | 2 | なし (Medium、1 行修正) |
| 03 VULN-001 staging cap | 3 | 2 | 1.0 | 6.0 | 2 | なし |
| 06 VULN-401 mask fail-closed | 2 | 2 | 1.0 | 4.0 | 2 | なし |
| 04 VULN-002 backup 予算 | 2 | 1 | 1.0 | 2.0 | 2 | なし |
| 05 VULN-003 キー衝突解消 | 2 | 1 | 1.0 | 2.0 | 2 | なし |
| 07 VULN-060 tranco 行数バウンド | 2 | 1 | 1.0 | 2.0 | 2 | なし |
| 08 defense-in-depth hardening | 2 | 0.5 | 0.8 | 0.8 | 3 | Code Quality (脆弱性でない) — オプション性を明記 |

実行順: 02 → 03/04/05/06/07 → 08。ファイル排他でバッチ並列 (02/05/06/08、03/04/07)。

## PBI 一覧

| NN | PBI | 種別 | RICE | SP | 状態 |
|---|---|---|---:|---:|---|
| 02 | [2026-11-27-02-fix-research-report-link-injection.md](2026-11-27-02-fix-research-report-link-injection.md) | fix | 12.0 | 2 | ⬜ |
| 03 | [2026-11-27-03-fix-staging-registry-cap.md](2026-11-27-03-fix-staging-registry-cap.md) | fix | 6.0 | 2 | ⬜ |
| 04 | [2026-11-27-04-fix-backup-byte-budget.md](2026-11-27-04-fix-backup-byte-budget.md) | fix | 2.0 | 2 | ⬜ |
| 05 | [2026-11-27-05-fix-ublock-cache-digest.md](2026-11-27-05-fix-ublock-cache-digest.md) | fix | 2.0 | 2 | ⬜ |
| 06 | [2026-11-27-06-fix-webhook-mask-fail-closed.md](2026-11-27-06-fix-webhook-mask-fail-closed.md) | fix | 4.0 | 2 | ⬜ |
| 07 | [2026-11-27-07-fix-tranco-line-bound.md](2026-11-27-07-fix-tranco-line-bound.md) | fix | 2.0 | 2 | ⬜ |
| 08 | [2026-11-27-08-chore-defense-in-depth-hardening.md](2026-11-27-08-chore-defense-in-depth-hardening.md) | chore | 0.8 | 3 | ⬜ |

## Code Quality 裁定 (VulnHunter 報告書 §Code Quality)

- CWE-312 plaintext-secret fallback (encryptionSession.ts:277-280): Gate 2a 失敗
  (in-scope attacker は鍵有無に関わらず chrome.storage.local を直接読める) → Code Quality 降格
- CWE-367 lost-update race (RateLimitService.ts:127-149): Gate 3 失敗
  (extension-page tier は既に offline brute-force 可能) → Code Quality 降格
- SG-4 NAV CWE-862 consent re-read asymmetry: Gate 3 elimination 再確認済み
  (defense-in-depth note)
→ PBI 08 に hardening として集約 (着手はオプション、脆弱性ではない)
