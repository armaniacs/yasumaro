# PBI Index

`pbi/` 配下のPBI実装状況一覧。新規PBI作成時・実装完了時はこの表を更新すること。

凡例: ⬜ 未着手 / 実装完了したPBIは `archive/` へ移動する
難易度: 🟢低（1pt目安） / 🟡中（2pt目安） / 🔴高（3pt以上目安） — 各PBI内「見積もり」セクションのポイントに基づく
副作用: 🔴あり（既存機能・既存ユーザーに実害の可能性） / 🟡軽微（コスト増や要検証点はあるが致命的でない） / 🟢なし（安全に対処可能） — [side-effects.md](../plans/2026-07-18-0522-review-side-effects.md)の元指摘判定に基づく

---

## 未着手 ⬜

未着手のPBIはありません。

---

### 元指摘カテゴリ別一覧

コンテンツ抽出品質:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

セキュリティ・防御的実装:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

データ整合性・移行:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

ストレージ・パフォーマンス:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

アクセシビリティ・i18n:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-16](2026-07-18-16-feat-plural-locale-support.md) | L4 | 複数形・数量表現のロケール対応 | 🔴高（3pt） | 🟢なし |

サプライチェーン・依存関係:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

DX・保守性:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

UI・ドキュメント:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

---

## アーカイブ

完了済みPBIは [archive/](archive/) に移動する。運用手順は各PBIスキルのライフサイクル節を参照。

今回アーカイブ済み（実装完了確認済み）:
- 2026-07-19-02-fix-anond-whitelist-adapter.md
- 2026-07-19-01-fix-ai-duration-measurement.md
- 2026-07-18-20-fix-session-store-storage-backend.md
- 2026-07-18-33-feat-message-protocol-versioning.md
- 2026-07-18-29-fix-optimistic-lock-cas-reverification.md
- 2026-07-18-31-fix-wa-sqlite-exact-version-pin.md
- 2026-07-18-11-fix-consent-state-changed-sender-validation.md
- 2026-07-18-26-feat-mobile-offscreen-queue-limit.md
- 2026-07-18-32-fix-recording-pipeline-factory-extraction.md
- 2026-07-18-22-fix-dashboard-tablist-aria-roles.md
- 2026-07-18-23-fix-permissions-page-i18n.md
- 2026-07-18-34-fix-log-source-auto-completion.md
- 2026-07-18-15-feat-readme-architecture-and-privacy-section.md
- 2026-07-13-03-fix-sqlite-history-panel-deepening.md
- 2026-07-16-02-fix-architecture-knowledge-graph-findings.md
- 2026-07-16-04-fix-adr014-file-references.md
- 2026-07-16-05-fix-sqlite-message-type-unification.md
- 2026-07-16-06-fix-idb-fallback-subframe7536-migration.md
- 2026-07-16-07-decide-opfs-migration-v2-removal.md
- 2026-07-17-08-dashboard-opfs-migration-status.md
- 2026-07-17-09-feat-audit-log-tsv-download.md
- 2026-07-18-10-fix-remove-dead-history-panel-code.md
- 2026-07-18-12-fix-content-script-sender-validation.md
- 2026-07-18-13-fix-popup-width-responsive.md
- 2026-07-18-14-fix-uuid-override-range.md
- 2026-07-18-17-fix-crypto-random-log-id-fallback.md
- 2026-07-18-18-fix-migration-backup-columns-coverage.md
- 2026-07-18-21-fix-dashboard-html-lang-attribute.md
- 2026-07-18-24-fix-tab-switch-focus-movement.md
- 2026-07-18-25-fix-remove-noop-optimistic-lock-save-sqlite.md
- 2026-07-18-27-fix-log-retention-quota-separation.md
- 2026-07-18-35-fix-barrel-reexport-deprecation-notice.md
- 2026-07-18-19-fix-storage-quota-unlimited-storage-check.md
- 2026-07-18-16-feat-plural-locale-support.md
- 2026-07-18-36-feat-automate-third-party-notices.md
- 2026-07-18-30-fix-consolidate-duplicate-i18n-modules.md
- 2026-07-18-28-fix-pending-sqlite-queue-batch-insert.md
- 2026-07-18-StorageBackend設計ドキュメント更新

## 集計

| 状態 | 件数 |
|---|---|
| ⬜ 未着手 | 0 |
| アーカイブ済み | 62 |
| **合計（archive除く）** | 0 |
