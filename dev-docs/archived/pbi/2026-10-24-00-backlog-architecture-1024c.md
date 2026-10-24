# 建築改善バックログ第3弾（2026-10-24）

> `improve-codebase-architecture` による診断第3弾（codebase-design 語彙、永続化スライス＋AI/信頼/構成の並列探索、HTMLレポート出力済み）の結果台帳。10 候補のうち Speculative 2 件を除外して 8 PBI にした。コード変更は一切行っていない。レポート: `/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/architecture-review-20261024c.html`。

## RICE スコア表（全 8 PBI）

RICE = Reach（影響する利用箇所・経路数）× Impact（3=実害解消 / 2=大 / 1=中）× Confidence（1.0=確定 / 0.8=設計判断残り）÷ Effort（人日）

| 順位 | PBI | テーマ | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 01 | [2026-10-24-01](2026-10-24-01-refactor-fallback-test-seam.md) | test seam対称化 | 3 | 2 | 1.0 | 0.5 | 12 |
| 02 | [2026-10-24-02](2026-10-24-02-refactor-hmac-codec-single-owner.md) | HMAC単一所有 | 5 | 3 | 0.8 | 1.5 | 8 |
| 03 | [2026-10-24-03](2026-10-24-03-refactor-builtin-client-sharing.md) | client実体共有 | 5 | 2 | 0.8 | 1.0 | 8 |
| 04 | [2026-10-24-04](2026-10-24-04-refactor-provider-catalog-derivation.md) | 追加手順の導出化 | 6 | 2 | 0.8 | 1.5 | 6.4 |
| 05 | [2026-10-24-05](2026-10-24-05-refactor-sync-runner-fold.md) | runner畳み込み | 4 | 1 | 1.0 | 0.75 | 5.3 |
| 06 | [2026-10-24-06](2026-10-24-06-refactor-backup-shape-query.md) | 照会集約 | 6 | 2 | 0.8 | 2.0 | 4.8 |
| 07 | [2026-10-24-07](2026-10-24-07-refactor-sqlite-repo-fold.md) | 委譲3枚畳み込み | 6 | 1 | 0.8 | 1.5 | 3.2 |
| 08 | [2026-10-24-08](2026-10-24-08-refactor-obsidian-config-seam.md) | 設定読みseam化 | 4 | 1 | 0.8 | 1.0 | 3.2 |

## 依存グラフと実施順の推奨

- **RICE 順が既定**。同点（02/03 = 8）は鍵喪失級の NN02 を先に。同点（07/08 = 3.2）は mock 削減の NN07 を先に。
- **NN03 → NN04**: RemoteAIServiceに触れるため実体共有を先に。
- **NN02 → NN06**: settingsExportImportに触れるため単一所有を先に。
- **NN07 → NN06**: dbMaintenanceに触れるため委譲畳み込みを先に。
- **並列可**: NN01 / NN02 / NN05 / NN08 は互いに独立。NN03 / NN07 は互いに独立。NN04 / NN06 は互いに独立。

## 除外（PBI 化しない）

- 永続化open往復の再設計（Speculative）：design-it-twiceが先行条件。現状維持し再評価待ち。
- WASMハイブリッド登録束ね（Speculative）：rust系PBIと重複可能性。現状維持し再評価待ち。

## 次のアクションの案内

- 実装するなら autonomous-task-closer（RICE 順・依存順でバッチ並列実装〜検証〜版上げ）。
- 個別に手動実装なら各 PBI ファイルを開く。
