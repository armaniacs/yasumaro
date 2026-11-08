# 2026-11-08 backlog: adversarial-code-review発見のPBI化(17件)

2026-11-08 の adversarial-code-review (対象: リポジトリ全体、作業ツリー差分なし) で出た発見171件を反証検証し、**SURVIVES 97件 / REJECTED 74件**。生き残り97件をテーマごとに17候補へ集約し、RICE採点してPBI化した。却下74件はPBI化しない(検証時に配線まで遡って反証済み)。

却下の内訳(代表): popup/DashboardのXSS鎖3件(CSP `script-src 'self'` が抑止・background再検証が抑止)、content自己発火2件(利得不成立・再送は有界)、fetch再試行・リダイレクト・KDFの3件(到達経路なし・有界)、storage楽観ロック4件(本番到達経路なし・verifyPostWriteが救済)、WASM fail-open(不正形はthrowしてフォールバックに落ちる)、TEST_AI runId(extension-onlyでharm不成立)、保守系の将来仮定・到達不能分岐など。

## RICE採点

前提: 全候補 非機能追加(セキュリティ・正確性・保守性)。Reach は影響利用者・開発者タッチ、Impact は 3=圧倒的 / 2=大きい / 1=中 / 0.5=小、Confidence は推定への確信度、Effort は人日。

| 順位 | 候補 | Reach | Impact | Confidence | Effort | RICE | SP | PBI |
|---:|---|---:|---:|---:|---:|---:|---:|---|
| 1 | SSRFガードのDNSピン留めとlocalhost既定拒否 | 200 | 3 | 80% | 2.0 | 240 | M | [2026-11-08-01-fix-ssrf-dns-pinning.md](2026-11-08-01-fix-ssrf-dns-pinning.md) |
| 2 | 訪問ゲーティング・滞在判定の正確性修正 | 300 | 2 | 80% | 2.0 | 240 | M | [2026-11-08-02-fix-visit-gating-correctness.md](2026-11-08-02-fix-visit-gating-correctness.md) |
| 3 | プライバシー確認通知のタイトル無害化 | 150 | 1 | 80% | 0.5 | 240 | S | [2026-11-08-03-fix-notification-title-sanitize.md](2026-11-08-03-fix-notification-title-sanitize.md) |
| 4 | sessionStoreの耐久性と失敗可視化 | 300 | 2 | 80% | 3.0 | 160 | L | [2026-11-08-04-fix-sessionstore-durability.md](2026-11-08-04-fix-sessionstore-durability.md) |
| 5 | content script連携の堅牢性修正 | 300 | 1 | 80% | 2.0 | 120 | M | [2026-11-08-05-fix-content-messaging-robustness.md](2026-11-08-05-fix-content-messaging-robustness.md) |
| 6 | DASHBOARD_SQLITEの行・値検証 | 100 | 2 | 80% | 1.5 | 107 | M | [2026-11-08-06-fix-dashboard-sqlite-validation.md](2026-11-08-06-fix-dashboard-sqlite-validation.md) |
| 7 | 記録パイプラインの回復・再試行の正確性 | 200 | 2 | 80% | 3.0 | 107 | L | [2026-11-08-07-fix-recording-pipeline.md](2026-11-08-07-fix-recording-pipeline.md) |
| 8 | popupエラーハンドリングの可視化と二重実行防止 | 200 | 1 | 80% | 1.5 | 107 | M | [2026-11-08-08-fix-popup-error-handling.md](2026-11-08-08-fix-popup-error-handling.md) |
| 9 | 要約クリーナーと私的判定の正確性 | 200 | 1 | 80% | 2.0 | 80 | M | [2026-11-08-09-fix-cleaner-privacy-accuracy.md](2026-11-08-09-fix-cleaner-privacy-accuracy.md) |
| 10 | 起動マイグレーションの再試行と状態検証 | 100 | 2 | 50% | 2.0 | 50 | M | [2026-11-08-10-fix-migration-robustness.md](2026-11-08-10-fix-migration-robustness.md) |
| 11 | Mutexの所有権検証とタイムアウト契約 | 50 | 1 | 80% | 1.0 | 40 | S | [2026-11-08-11-fix-mutex-ownership.md](2026-11-08-11-fix-mutex-ownership.md) |
| 12 | messaging層の型境界と検証漏れの是正 | 80 | 1 | 80% | 2.0 | 32 | M | [2026-11-08-12-fix-messaging-seam.md](2026-11-08-12-fix-messaging-seam.md) |
| 13 | 配線・起動順序の可視化と将来破壊の防止 | 60 | 1 | 80% | 1.5 | 32 | M | [2026-11-08-13-fix-wiring-startup.md](2026-11-08-13-fix-wiring-startup.md) |
| 14 | popup・dashboardのi18n漏れと信頼性向上 | 150 | 0.5 | 80% | 2.0 | 30 | M | [2026-11-08-14-fix-popup-dashboard-i18n-reliability.md](2026-11-08-14-fix-popup-dashboard-i18n-reliability.md) |
| 15 | privacyレンダラーの構文対応と表示崩れ防止 | 30 | 0.5 | 80% | 0.5 | 24 | S | [2026-11-08-15-fix-privacy-renderer.md](2026-11-08-15-fix-privacy-renderer.md) |
| 16 | 定数・上限値の集約と二重管理の解消 | 40 | 0.5 | 80% | 1.0 | 16 | S | [2026-11-08-16-refactor-config-consolidation.md](2026-11-08-16-refactor-config-consolidation.md) |
| 17 | 入力検証の境界・型・文言依存の是正 | 50 | 0.5 | 80% | 1.5 | 13 | S | [2026-11-08-17-fix-validation-limits.md](2026-11-08-17-fix-validation-limits.md) |

実行順(依存なし): 01 → 02 → 03 → … → 17。01・02・03は同点だがリスク順でSSRFを先頭にした。11は07への弱い順序前提のため07より先に着手推奨。03・15・16は工数小のため同日バッチ可(ファイルが重ならないため並列可)。

## 採点の根拠

- **順位 1〜3(同点240)**: セキュリティと記録正確性の最上位。01は唯一のSURVIVESであるSSRF実 exploitable 経路、02は全利用者の記録正確性6件、03は工数0.5で閉じる信頼UI注入。
- **順位 4(sessionStore 160)**: データ消失系7件の一括対処。Effort 3.0で4位。
- **順位 5〜8**: ハング・重複・不正行・無音失敗の利用者影響系。06と07と08は同点107で完全性・信頼性・可視性の順に配置。
- **順位 9〜11**: 判定正確性・移行・Mutex。10は発生稀でConfidence 50%。
- **順位 12〜17**: 保守性・表示品質中心。いずれも単独S〜Mで並列着手可。

## 出典

- adversarial-code-review (2026-11-08、対象: リポジトリ全体)。発見10チャンク×2視点の並列レビュー、検証15体による全件反証を経て報告。
