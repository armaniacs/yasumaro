# PBI Index

`pbi/` 配下のPBI実装状況一覧。新規PBI作成時・実装完了時はこの表を更新すること。

凡例: ⬜ 未着手 / 🔶 部分実装（一部基準のみ満たす） / 実装完了したPBIは `dev-docs/archived/pbi/` へ移動する
難易度: 🟢低（1pt目安） / 🟡中（2pt目安） / 🔴高（3pt以上目安） — 各PBI内「見積もり」セクションのポイントに基づく
副作用: 🔴あり（既存機能・既存ユーザーに実害の可能性） / 🟡軽微（コスト増や要検証点はあるが致命的でない） / 🟢なし（安全に対処可能） — [side-effects.md](../plans/2026-07-18-0522-review-side-effects.md)の元指摘判定に基づく

---

## 実装順序（推奨）

依存関係: **PBI-03 (i18n分離) → PBI-05 (UI修正)** の順序必須。他は独立。

| 順位 | PBI | ポイント | 理由 |
|:----:|-----|:--------:|------|
| 1 | [08](2026-07-20-08-fix-changelog-release-note-guidelines.md) | 1pt | 最小、ドキュメントのみ |
| 2 | [07](2026-07-20-07-fix-data-integrity-cleanup.md) | 2pt | 小規模リファクタリング、他と独立 |
| 3 | [03](2026-07-20-03-fix-i18n-module-separation.md) | 3pt | PBI-05 の前提。先に完了させる |
| 4 | [05](2026-07-20-05-fix-ui-css-touchups.md) | 3pt | PBI-03 完了後に着手 |
| 5 | [04](2026-07-20-04-fix-content-extractor-cleansing-config.md) | 3pt | extractor.ts に閉じた変更 |
| 6 | [09](2026-07-20-09-fix-docs-dual-translation-system.md) | 3pt | 独立したビルドスクリプト追加 |
| 7 | [06](2026-07-20-06-fix-security-privacy-extensions.md) | 5pt | 独立した3機能を含む |
| 8 | [22](2026-07-20-22-fix-local-ai-pii-masking-order.md) | 2pt | プライバシー改善 |
| 10 | [14](2026-07-20-14-fix-content-script-performance.md) | 3pt | パフォーマンス改善、影響範囲広 |
| 11 | [15](2026-07-20-15-fix-logger-sw-resilience.md) | 3pt | SW ライフサイクル、Logger アーキテクチャ変更 |
| 12 | [16](2026-07-20-16-feat-ai-usage-controls.md) | 3pt | 設定 UI 追加 |
| 13 | [20](2026-07-20-20-fix-external-endpoint-configurability.md) | 3pt | Obsidian/Gemini 設定追加 |

---

## 未着手 ⬜ / 部分実装 🔶

| PBI | カテゴリ | タイトル | 難易度 | 副作用 | 状態 |
|---|---|---|---|---|---|
| [2026-07-20-14](2026-07-20-14-fix-content-script-performance.md) | ストレージ・パフォーマンス | コンテンツスクリプトのスクロール/ポーリング負荷軽減 | 🟡中（3pt） | 🟡軽微 | ⬜ 未着手 |
| [2026-07-20-15](2026-07-20-15-fix-logger-sw-resilience.md) | ストレージ・パフォーマンス | Logger の Service Worker 終了耐性強化 | 🟡中（3pt） | 🟡軽微 | ⬜ 未着手 |
| [2026-07-20-16](2026-07-20-16-feat-ai-usage-controls.md) | ストレージ・パフォーマンス | AI 使用量ハードリミットとレート制限のユーザー設定化 | 🟡中（3pt） | 🟡軽微 | ⬜ 未着手 |
| [2026-07-20-20](2026-07-20-20-fix-external-endpoint-configurability.md) | セキュリティ・防御的実装 | ObsidianClient の中央 fetch 統合と外部エンドポイント設定化 | 🟡中（3pt） | 🟡軽微 | ⬜ 未着手 |
| [2026-07-20-22](2026-07-20-22-fix-local-ai-pii-masking-order.md) | セキュリティ・防御的実装 | ローカル AI 要約前の PII マスキング適用 | 🟡中（2pt） | 🟡軽微 | ⬜ 未着手 |

---

### 元指摘カテゴリ別一覧

コンテンツ抽出品質:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

セキュリティ・防御的実装:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-20-20](2026-07-20-20-fix-external-endpoint-configurability.md) | Checking Team High/Medium | ObsidianClient の中央 fetch 統合と外部エンドポイント設定化 | 🟡中（3pt） | 🟡軽微 |
| [2026-07-20-22](2026-07-20-22-fix-local-ai-pii-masking-order.md) | Checking Team Medium | ローカル AI 要約前の PII マスキング適用 | 🟡中（2pt） | 🟡軽微 |

データ整合性・移行:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|

ストレージ・パフォーマンス:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-20-14](2026-07-20-14-fix-content-script-performance.md) | Checking Team High/Medium | コンテンツスクリプトのスクロール/ポーリング負荷軽減 | 🟡中（3pt） | 🟡軽微 |
| [2026-07-20-15](2026-07-20-15-fix-logger-sw-resilience.md) | Checking Team High | Logger の Service Worker 終了耐性強化 | 🟡中（3pt） | 🟡軽微 |
| [2026-07-20-16](2026-07-20-16-feat-ai-usage-controls.md) | Checking Team High/Medium | AI 使用量ハードリミットとレート制限のユーザー設定化 | 🟡中（3pt） | 🟡軽微 |

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

完了済みPBIは [dev-docs/archived/pbi/](../../dev-docs/archived/pbi/) に移動する。運用手順は各PBIスキルのライフサイクル節を参照。

今回アーカイブ済み（実装完了確認済み）:
- 2026-07-20-11-fix-opfs-sqlite-transaction-integrity.md
- 2026-07-20-10-feat-offline-network-queue.md
- 2026-07-20-02-fix-session-store-resilience.md
- 2026-07-20-01-fix-message-type-unification.md
- 2026-07-20-23-fix-ci-dx-improvements.md
- 2026-07-20-21-fix-dashboard-i18n-locale-fallback.md
- 2026-07-20-19-cleanup-conflictstats-docs.md
- 2026-07-20-18-fix-supply-chain-adm-zip.md
- 2026-07-20-17-fix-mobile-accessibility-frontend.md
- 2026-07-20-13-fix-ai-provider-response-validation.md
- 2026-07-20-12-fix-gist-sync-completeness.md
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
- 2026-07-18-StorageBackend設計ドキュメント更新

## 集計

| 状態 | 件数 |
|---|---|
| ⬜ 未着手 | 5 |
| 🔶 部分実装 | 0 |
| アーカイブ済み | 80 |
| **合計（archive除く）** | 5 |
