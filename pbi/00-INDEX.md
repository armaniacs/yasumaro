# PBI Index

`pbi/` 配下のPBI実装状況一覧。新規PBI作成時・実装完了時はこの表を更新すること。

凡例: ⬜ 未着手 / 🔶 部分実装（一部基準のみ満たす） / 実装完了したPBIは `dev-docs/archived/pbi/` へ移動する
難易度: 🟢低（1pt目安） / 🟡中（2pt目安） / 🔴高（3pt以上目安） — 各PBI内「見積もり」セクションのポイントに基づく
副作用: 🔴あり（既存機能・既存ユーザーに実害の可能性） / 🟡軽微（コスト増や要検証点はあるが致命的でない） / 🟢なし（安全に対処可能）

---

## 未着手 ⬜ / 部分実装 🔶

| PBI | 難易度 | 副作用 | 状態 |
|-----|--------|--------|------|
| [2026-07-22-01-doc-response-size-limit-adr.md](2026-07-22-01-doc-response-size-limit-adr.md) | 🟡中 | 🟢なし | ✅ |
| [2026-07-22-02-refactor-response-size-limit-detection.md](2026-07-22-02-refactor-response-size-limit-detection.md) | 🔴高 | 🟡軽微 | 🔶 |
| [2026-07-22-03-refactor-i18n-mode-key-names.md](2026-07-22-03-refactor-i18n-mode-key-names.md) | 🟡中 | 🔴あり | ⬜ |

新規PBIは `pbi/YYYY-MM-DD-NN-type-slug.md` として作成してください。

---

## アーカイブ

完了済みPBIは [dev-docs/archived/pbi/](../../dev-docs/archived/pbi/) に移動する。

今回アーカイブ済み（実装完了確認済み）:
- 2026-07-22-07-back-security-lint-rule-and-review-checklist.md (lint rules + PR template)
- 2026-07-22-01-fix-obsidian-markdown-injection-core.md (VULN-001,002,004,005)
- 2026-07-22-02-fix-obsidian-markdown-injection-downstream.md (VULN-006,007,020)
- 2026-07-22-03-fix-reliability-races-resource-exhaustion.md (VULN-003,008,011,012,014,016)
- 2026-07-22-04-fix-settings-import-bypass-ssrf.md (VULN-009,010,013)
- 2026-07-22-05-fix-master-password-lockout.md (VULN-018,021)
- 2026-07-22-06-fix-master-password-protection-integrity.md (VULN-015,017,019)
- 2026-07-21-04-refactor-hardening-diagnostics-errors.md
- 2026-07-21-03-refactor-dedup-diagnostics-panel.md
- 2026-07-21-02-refactor-ai-provider-commons.md
- 2026-07-21-01-fix-diagnostic-security.md
- 2026-07-20-12-fix-gist-sync-completeness.md
- 2026-07-20-13-fix-ai-provider-response-validation.md
- 2026-07-20-17-fix-mobile-accessibility-frontend.md
- 2026-07-20-21-fix-dashboard-i18n-locale-fallback.md
- 2026-07-20-18-fix-supply-chain-adm-zip.md
- 2026-07-20-23-fix-ci-dx-improvements.md
- 2026-07-20-19-cleanup-conflictstats-docs.md
- 2026-07-20-20-fix-external-endpoint-configurability.md
- 2026-07-20-16-feat-ai-usage-controls.md
- 2026-07-20-15-fix-logger-sw-resilience.md
- 2026-07-20-14-fix-content-script-performance.md
- 2026-07-20-22-fix-local-ai-pii-masking-order.md
- 2026-07-20-11-fix-opfs-sqlite-transaction-integrity.md
- 2026-07-20-10-feat-offline-network-queue.md
- 2026-07-20-02-fix-session-store-resilience.md
- 2026-07-20-01-fix-message-type-unification.md
- 2026-07-20-09-fix-docs-dual-translation-system.md
- 2026-07-20-08-fix-changelog-release-note-guidelines.md
- 2026-07-20-07-fix-data-integrity-cleanup.md
- 2026-07-20-06-fix-security-privacy-extensions.md
- 2026-07-20-05-fix-ui-css-touchups.md
- 2026-07-20-04-fix-content-extractor-cleansing-config.md
- 2026-07-20-03-fix-i18n-module-separation.md
- 2026-07-19-02-fix-anond-whitelist-adapter.md
- 2026-07-19-01-fix-ai-duration-measurement.md
- 2026-07-18-36-feat-automate-third-party-notices.md
- 2026-07-18-35-fix-barrel-reexport-deprecation-notice.md
- 2026-07-18-34-fix-log-source-auto-completion.md
- 2026-07-18-33-feat-message-protocol-versioning.md
- 2026-07-18-32-fix-recording-pipeline-factory-extraction.md
- 2026-07-18-31-fix-wa-sqlite-exact-version-pin.md
- 2026-07-18-30-fix-consolidate-duplicate-i18n-modules.md
- 2026-07-18-29-fix-optimistic-lock-cas-reverification.md
- 2026-07-18-28-fix-pending-sqlite-queue-batch-insert.md
- 2026-07-18-27-fix-log-retention-quota-separation.md
- 2026-07-18-26-feat-mobile-offscreen-queue-limit.md
- 2026-07-18-25-fix-remove-noop-optimistic-lock-save-sqlite.md
- 2026-07-18-24-fix-tab-switch-focus-movement.md
- 2026-07-18-23-fix-permissions-page-i18n.md
- 2026-07-18-22-fix-dashboard-tablist-aria-roles.md
- 2026-07-18-21-fix-dashboard-html-lang-attribute.md
- 2026-07-18-20-fix-session-store-storage-backend.md
- 2026-07-18-19-fix-storage-quota-unlimited-storage-check.md
- 2026-07-18-18-fix-migration-backup-columns-coverage.md
- 2026-07-18-17-fix-crypto-random-log-id-fallback.md
- 2026-07-18-16-feat-plural-locale-support.md
- 2026-07-18-15-feat-readme-architecture-and-privacy-section.md
- 2026-07-18-14-fix-uuid-override-range.md
- 2026-07-18-13-fix-popup-width-responsive.md
- 2026-07-18-12-fix-content-script-sender-validation.md
- 2026-07-18-11-fix-consent-state-changed-sender-validation.md
- 2026-07-18-10-fix-remove-dead-history-panel-code.md
- 2026-07-17-09-feat-audit-log-tsv-download.md
- 2026-07-17-08-dashboard-opfs-migration-status.md
- 2026-07-16-07-decide-opfs-migration-v2-removal.md
- 2026-07-16-06-fix-idb-fallback-subframe7536-migration.md
- 2026-07-16-05-fix-sqlite-message-type-unification.md
- 2026-07-16-04-fix-adr014-file-references.md
- 2026-07-16-02-fix-architecture-knowledge-graph-findings.md
- 2026-07-13-03-fix-sqlite-history-panel-deepening.md

## 集計

| 状態 | 件数 |
|---|---|
| ⬜ 未着手 | 0 |
| 🔶 部分実装 | 0 |
| アーカイブ済み | 100 |
