# Backlog: 2026-08-27 Adversarial Fixes 7件

## 概要
直近の adversarial review で検出された 7件 (Hacker 3 / Maintainer 4) を RICE で優先度付け。SSRF/任意SQL/XSS が最優先。

## RICE スコア表
| 順位 | PBI | RICE | Reach | Impact | Conf | Effort | 分類 |
|------|-----|------|-------|--------|------|--------|------|
| 1 | 05-ssrfguard-zero-ip | 3600 | 60 | 3 | 100% | 0.05 | Hacker |
| 2 | 06-opfs-worker-sql-exec | 1200 | 40 | 3 | 100% | 0.10 | Hacker |
| 2 | 07-manual-fetcher-ssrf | 1200 | 40 | 3 | 100% | 0.10 | Hacker |
| 4 | 08-backup-restore-trigger | 270 | 20 | 3 | 90% | 0.20 | Maintainer |
| 5 | 09-saved-url-atomic | 180 | 30 | 1.5 | 80% | 0.20 | Maintainer |
| 6 | 10-page-state-duplicate | 160 | 20 | 1 | 80% | 0.10 | Maintainer |
| 7 | 11-mutex-deadlock | 140 | 20 | 1.5 | 80% | 0.15 | Maintainer |

同点は SSRF の外部到達性で決定。

## 依存関係
- 全7件は触るファイルが異なるため並列実行可能 (payloadGuard/popup/permission ではない)
- 05,06,07は独立、08はDB層、09はstorage、10はcontent、11はutils

## 推奨着手順
- Wave1 (3並列): 05,06,07
- Wave2 (4並列): 08,09,10,11

## 出力ファイル
- `pbi/2026-08-27-05-fix-ssrfguard-zero-ip.md`
- `pbi/2026-08-27-06-fix-opfs-worker-sql-exec.md`
- `pbi/2026-08-27-07-fix-manual-fetcher-ssrf.md`
- `pbi/2026-08-27-08-fix-backup-restore-trigger.md`
- `pbi/2026-08-27-09-fix-saved-url-atomic.md`
- `pbi/2026-08-27-10-fix-page-state-duplicate.md`
- `pbi/2026-08-27-11-fix-mutex-deadlock.md`
