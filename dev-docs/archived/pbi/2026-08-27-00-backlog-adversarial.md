# Backlog: 2026-08-27 Adversarial Review 17件 — 全修正

## 概要
`adversarial-code-review` 全コードベースレビューで検出された 17件 (Hacker 9 / Maintainer 8) を RICE で優先度付け。Stored XSS とバイト長迂回が最優先。SSOT化とDoS対策を並列化可能なバッチに分割。

## RICE スコア表
| 順位 | PBI | RICE | Reach | Impact | Conf | Effort | 分類 | 根拠 |
|------|-----|------|-------|--------|------|--------|------|------|
| 1 | 15-pending-pages-xss | 4800 | 80 | 3 | 100% | 0.05 | Hacker | Stored XSS in chrome-extension:// |
| 2 | 13-payloadguard-byte-length | 4800 | 80 | 3 | 100% | 0.05 | Hacker | 1MBバイト制限を2-3倍迂回 |
| 3 | 20-permission-manager-dos | 960 | 40 | 1.5 | 80% | 0.05 | Hacker | 無制限キー蓄積でquota枯渇 |
| 4 | 18-ublock-cache-shallow-copy | 720 | 30 | 1.5 | 80% | 0.05 | Hacker | shallow copyでキャッシュ汚染 |
| 5 | 17-pii-credit-card-regex | 600 | 50 | 1.5 | 80% | 0.10 | Hacker | 連続16桁未検出でPCI流出 |
| 6 | 16-ssrfguard-localhost | 420 | 30 | 2 | 70% | 0.10 | Hacker | 127.0.0.1除外でno-op |
| 6 | 27-domain-verifier-endswith | 420 | 30 | 2 | 70% | 0.10 | Maintainer | endsWithで広範誤信頼 |
| 8 | 14-manual-content-fetcher-rate-limit | 320 | 40 | 2 | 80% | 0.20 | Hacker | 任意httpsタブ+rateLimit迂回 |
| 8 | 22-page-state-shallow-copy | 320 | 20 | 1 | 80% | 0.05 | Maintainer | デフォルト汚染 |
| 8 | 23-extractor-boolean | 320 | 20 | 1 | 80% | 0.05 | Maintainer | "false"反転 |
| 11 | 24-per-url-mutex-leak | 315 | 30 | 1.5 | 70% | 0.10 | Maintainer | queue fullで永残 |
| 12 | 26-ublock-domain-validation | 280 | 20 | 1 | 70% | 0.05 | Maintainer | *許可でブロッキング爆発 |
| 13 | 21-optimistic-lock-toc | 225 | 30 | 2 | 75% | 0.20 | Hacker | postWrite検証無効でTOCTOU |
| 14 | 25-confirm-token-best-effort | 140 | 20 | 1 | 70% | 0.10 | Maintainer | トークン乖離で恒久失敗 |
| 14 | 28-saved-url-non-atomic | 140 | 20 | 1 | 70% | 0.10 | Maintainer | 非原子で不整合 |
| 14 | 29-mutex-timeout-race | 140 | 20 | 1 | 70% | 0.10 | Maintainer | 二重resolve |
| 17 | 19-trustdb-bloom-hash | 93 | 20 | 2 | 70% | 0.30 | Hacker | 非暗号ハッシュで偽装 |

同点はリスク軽減効果で決定。XSS/SSRF/PCIをDoSより優先。

## 依存関係
- 13,15,20,18は独立 — バッチ1で4並列可 (utils/offscreen/popup)
- 16,27は共にドメイン判定だが別ファイル (ssrfGuard vs domainVerifier) で並列可
- 14,22,23,24は別ディレクトリ (background/content) で並列可

## 推奨着手順
- Wave1 (4並列): 15,13,20,18
- Wave2 (4並列): 17,16,27,14
- Wave3 (4並列): 22,23,24,26
- Wave4 (4並列): 21,25,28,29
- Wave5 (1): 19

## 出力ファイル
- `pbi/2026-08-27-13-fix-payloadguard-byte-length.md` — 15 と同点1位、RICE 4800
- `pbi/2026-08-27-14-fix-manual-content-fetcher-rate-limit.md` — RICE 320
- `pbi/2026-08-27-15-fix-pending-pages-xss.md` — RICE 4800
- `pbi/2026-08-27-16-fix-ssrfguard-localhost.md` — RICE 420
- `pbi/2026-08-27-17-fix-pii-credit-card-regex.md` — RICE 600
- `pbi/2026-08-27-18-fix-ublock-cache-shallow-copy.md` — RICE 720
- `pbi/2026-08-27-19-fix-trustdb-bloom-hash.md` — RICE 93
- `pbi/2026-08-27-20-fix-permission-manager-dos.md` — RICE 960
- `pbi/2026-08-27-21-fix-optimistic-lock-toc.md` — RICE 225
- `pbi/2026-08-27-22-fix-page-state-shallow-copy.md` — RICE 320
- `pbi/2026-08-27-23-fix-extractor-boolean.md` — RICE 320
- `pbi/2026-08-27-24-fix-per-url-mutex-leak.md` — RICE 315
- `pbi/2026-08-27-25-fix-confirm-token-best-effort.md` — RICE 140
- `pbi/2026-08-27-26-fix-ublock-domain-validation.md` — RICE 280
- `pbi/2026-08-27-27-fix-domain-verifier-endswith.md` — RICE 420
- `pbi/2026-08-27-28-fix-saved-url-non-atomic.md` — RICE 140
- `pbi/2026-08-27-29-fix-mutex-timeout-race.md` — RICE 140
