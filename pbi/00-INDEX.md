# PBI Index

`pbi/` 配下のPBI実装状況一覧。新規PBI作成時・実装完了時はこの表を更新すること。

凡例: ⬜ 未着手 / 実装完了したPBIは `archive/` へ移動する
難易度: 🟢低（1pt目安） / 🟡中（2pt目安） / 🔴高（3pt以上目安） — 各PBI内「見積もり」セクションのポイントに基づく
副作用: 🔴あり（既存機能・既存ユーザーに実害の可能性） / 🟡軽微（コスト増や要検証点はあるが致命的でない） / 🟢なし（安全に対処可能） — [side-effects.md](../plans/2026-07-18-0522-review-side-effects.md)の元指摘判定に基づく

---

## 未着手 ⬜

### 着手順（難易度 × 副作用による優先順位）

方針: 「低難易度・副作用なし」から着手し、実害リスクのあるものは検証コストを見込んだ上で後回しにする。

| # | PBI | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| 1 | [2026-07-18-10](2026-07-18-10-fix-remove-dead-history-panel-code.md) | デッドコード化した旧SQLite履歴パネルの削除 | 🟢低（1pt） | 🟢なし |
| 2 | [2026-07-18-12](2026-07-18-12-fix-content-script-sender-validation.md) | Content Script GET_CONTENTハンドラへのsender.id検証 | 🟢低（1pt） | 🟢なし |
| 3 | [2026-07-18-17](2026-07-18-17-fix-crypto-random-log-id-fallback.md) | ログID生成のMath.randomフォールバックをCSPRNGに置き換え | 🟢低（1pt） | 🟢なし |
| 4 | [2026-07-18-25](2026-07-18-25-fix-remove-noop-optimistic-lock-save-sqlite.md) | saveSqliteStepの無意味な楽観的ロック削除 | 🟢低（1pt） | 🟢なし |
| 5 | [2026-07-18-18](2026-07-18-18-fix-migration-backup-columns-coverage.md) | IDB VFS移行バックアップのカラム網羅性を31カラムに拡張 | 🟢低（1pt） | 🟢なし |
| 6 | [2026-07-18-27](2026-07-18-27-fix-log-retention-quota-separation.md) | ログ保持期間の短縮とMAX_LOGS引き下げ | 🟢低（1pt） | 🟢なし |
| 7 | [2026-07-18-21](2026-07-18-21-fix-dashboard-html-lang-attribute.md) | Dashboard HTMLの初期lang属性を空文字から明示的な値に変更 | 🟢低（1pt） | 🟢なし |
| 8 | [2026-07-18-24](2026-07-18-24-fix-tab-switch-focus-movement.md) | 設定画面タブ切り替え後にフォーカス移動を追加 | 🟢低（1pt） | 🟢なし |
| 9 | [2026-07-18-14](2026-07-18-14-fix-uuid-override-range.md) | uuid overrideをSemVerレンジに変更 | 🟢低（1pt） | 🟢なし |
| 10 | [2026-07-18-35](2026-07-18-35-fix-barrel-reexport-deprecation-notice.md) | バレル再エクスポート層に@deprecated JSDocを追加 | 🟢低（1pt） | 🟢なし |
| 11 | [2026-07-18-13](2026-07-18-13-fix-popup-width-responsive.md) | ポップアップ幅の固定値をレスポンシブ対応に変更 | 🟢低（1pt） | 🟢なし |
| 12 | [2026-07-18-11](2026-07-18-11-fix-consent-state-changed-sender-validation.md) | CONSENT_STATE_CHANGEDハンドラへのsender.id検証 | 🟡中（2pt） | 🟢なし |
| 13 | [2026-07-18-26](2026-07-18-26-feat-mobile-offscreen-queue-limit.md) | モバイル環境向けOffscreen Mutexキュー上限の調整 | 🟡中（2pt） | 🟢なし |
| 14 | [2026-07-18-32](2026-07-18-32-fix-recording-pipeline-factory-extraction.md) | record()呼び出しごとのPipeline新規生成をファクトリ抽出で最適化 | 🟡中（2pt） | 🟢なし |
| 15 | [2026-07-18-22](2026-07-18-22-fix-dashboard-tablist-aria-roles.md) | ダッシュボードサイドバーにtablist/tab ARIAロールを付与 | 🟡中（2pt） | 🟢なし |
| 16 | [2026-07-18-23](2026-07-18-23-fix-permissions-page-i18n.md) | Permissionsページの日本語ハードコードをi18n対応化 | 🟡中（2pt） | 🟢なし |
| 17 | [2026-07-18-34](2026-07-18-34-fix-log-source-auto-completion.md) | ログ呼び出しのsourceパラメータ自動補完ヘルパー導入 | 🟡中（2pt） | 🟢なし |
| 18 | [2026-07-18-15](2026-07-18-15-feat-readme-architecture-and-privacy-section.md) | READMEにアーキテクチャ図とプライバシー機能セクションを追加 | 🟡中（2pt） | 🟢なし |
| 19 | [2026-07-18-16](2026-07-18-16-feat-plural-locale-support.md) | 複数形・数量表現のロケール対応 | 🔴高（3pt） | 🟢なし |
| 20 | [2026-07-18-33](2026-07-18-33-feat-message-protocol-versioning.md) | Content-SWメッセージプロトコルにprotocolVersionを追加 | 🔴高（3pt） | 🟢なし |
| 21 | [2026-07-18-36](2026-07-18-36-feat-automate-third-party-notices.md) | THIRD_PARTY_NOTICESを自動生成する仕組みをCIに導入 | 🔴高（3pt） | 🟢なし |
| 22 | [2026-07-18-31](2026-07-18-31-fix-wa-sqlite-exact-version-pin.md) | wa-sqlite依存を完全固定バージョンへ変更 | 🟢低（1pt） | 🟡軽微 |
| 23 | [2026-07-18-29](2026-07-18-29-fix-optimistic-lock-cas-reverification.md) | optimisticLock CAS操作の書き込み後再検証ステップ追加 | 🟡中（2pt） | 🟡軽微 |
| 24 | [2026-07-18-30](2026-07-18-30-fix-consolidate-duplicate-i18n-modules.md) | popup/optionsに重複するi18n.tsを共通モジュールへ統合 | 🔴高（3pt） | 🟡軽微 |
| 25 | [2026-07-18-19](2026-07-18-19-fix-storage-quota-unlimited-storage-check.md) | unlimitedStorage権限保持時のストレージクォータ判定修正 | 🟢低（1pt） | 🔴あり |
| 26 | [2026-07-18-28](2026-07-18-28-fix-pending-sqlite-queue-batch-insert.md) | pendingSqliteQueueをチャンク単位のバッチINSERTに変更 | 🟡中（2pt） | 🔴あり |
| 27 | [2026-07-18-20](2026-07-18-20-fix-session-store-storage-backend.md) | SessionStoreのバックエンドをchrome.storage.sessionに変更 | 🔴高（3pt） | 🔴あり |

**所見**:
- #1〜11（🟢低×🟢なし）は検証コストも小さいため、まとめて一気に消化できる
- #19〜21（🔴高×🟢なし）は副作用は心配ないが工数が大きいため、まとまった時間を確保してから着手
- #22〜24（🟡軽微）は着手前にPBI内「実装者向け注記」の要検証点を必ず読むこと
- #25〜27（🔴あり）は最後に回す。特に#27（SessionStore移行）は容量制限・offscreenアクセス設定・旧データ移行の3点が未解決のため、着手前に設計レビューを挟むことを推奨

---

### 元指摘カテゴリ別一覧

セキュリティ・防御的実装:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-11](2026-07-18-11-fix-consent-state-changed-sender-validation.md) | M1 | CONSENT_STATE_CHANGEDハンドラへのsender.id検証 | 🟡中（2pt） | 🟢なし |
| [2026-07-18-12](2026-07-18-12-fix-content-script-sender-validation.md) | M1 | Content Script GET_CONTENTハンドラへのsender.id検証 | 🟢低（1pt） | 🟢なし |
| [2026-07-18-17](2026-07-18-17-fix-crypto-random-log-id-fallback.md) | M2 | ログID生成のMath.randomフォールバックをCSPRNGに置き換え | 🟢低（1pt） | 🟢なし |

デッドコード・クリーンアップ:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-10](2026-07-18-10-fix-remove-dead-history-panel-code.md) | M31 | デッドコード化した旧SQLite履歴パネルの削除 | 🟢低（1pt） | 🟢なし |
| [2026-07-18-25](2026-07-18-25-fix-remove-noop-optimistic-lock-save-sqlite.md) | M32 | saveSqliteStepの無意味な楽観的ロック削除 | 🟢低（1pt） | 🟢なし |

データ整合性・移行:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-18](2026-07-18-18-fix-migration-backup-columns-coverage.md) | M4 | IDB VFS移行バックアップのカラム網羅性を31カラムに拡張 | 🟢低（1pt） | 🟢なし |
| [2026-07-18-28](2026-07-18-28-fix-pending-sqlite-queue-batch-insert.md) | M10 | pendingSqliteQueueをチャンク単位のバッチINSERTに変更 | 🟡中（2pt） | 🔴あり（バッチ化で「一部成功」ハンドリングが失われるリスク。PBI内で部分成功を維持する設計を明記済み） |
| [2026-07-18-29](2026-07-18-29-fix-optimistic-lock-cas-reverification.md) | M6 | optimisticLock CAS操作の書き込み後再検証ステップ追加 | 🟡中（2pt） | 🟡軽微（既に二重チェック実装済み。追加検証はI/O1回増でレイテンシ微増） |

ストレージ・パフォーマンス:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-19](2026-07-18-19-fix-storage-quota-unlimited-storage-check.md) | M7 | unlimitedStorage権限保持時のストレージクォータ判定修正 | 🟢低（1pt） | 🔴あり（`unlimitedStorage`権限で実質無害だが、値変更時はメモリ/パフォーマンス面の別制約に注意） |
| [2026-07-18-20](2026-07-18-20-fix-session-store-storage-backend.md) | M9 | SessionStoreのバックエンドをchrome.storage.sessionに変更 | 🔴高（3pt） | 🔴あり（`chrome.storage.session`の容量制限、offscreenからのアクセス設定、旧データ移行が必要） |
| [2026-07-18-26](2026-07-18-26-feat-mobile-offscreen-queue-limit.md) | L5 | モバイル環境向けOffscreen Mutexキュー上限の調整 | 🟡中（2pt） | 🟢なし |
| [2026-07-18-27](2026-07-18-27-fix-log-retention-quota-separation.md) | L8 | ログ保持期間の短縮とMAX_LOGS引き下げ | 🟢低（1pt） | 🟢なし |
| [2026-07-18-32](2026-07-18-32-fix-recording-pipeline-factory-extraction.md) | L7 | record()呼び出しごとのPipeline新規生成をファクトリ抽出で最適化 | 🟡中（2pt） | 🟢なし |

アクセシビリティ・i18n:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-21](2026-07-18-21-fix-dashboard-html-lang-attribute.md) | M19 | Dashboard HTMLの初期lang属性を空文字から明示的な値に変更 | 🟢低（1pt） | 🟢なし |
| [2026-07-18-22](2026-07-18-22-fix-dashboard-tablist-aria-roles.md) | M21 | ダッシュボードサイドバーにtablist/tab ARIAロールを付与 | 🟡中（2pt） | 🟢なし |
| [2026-07-18-23](2026-07-18-23-fix-permissions-page-i18n.md) | M22 | Permissionsページの日本語ハードコードをi18n対応化 | 🟡中（2pt） | 🟢なし |
| [2026-07-18-24](2026-07-18-24-fix-tab-switch-focus-movement.md) | M24 | 設定画面タブ切り替え後にフォーカス移動を追加 | 🟢低（1pt） | 🟢なし |
| [2026-07-18-30](2026-07-18-30-fix-consolidate-duplicate-i18n-modules.md) | M20 | popup/optionsに重複するi18n.tsを共通モジュールへ統合 | 🔴高（3pt） | 🟡軽微（3箇所に型シグネチャ・フォールバック挙動の実差分あり。統合時は挙動差の検証が必要） |
| [2026-07-18-16](2026-07-18-16-feat-plural-locale-support.md) | L4 | 複数形・数量表現のロケール対応 | 🔴高（3pt） | 🟢なし |

サプライチェーン・依存関係:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-14](2026-07-18-14-fix-uuid-override-range.md) | L10/L16 | uuid overrideをSemVerレンジに変更 | 🟢低（1pt） | 🟢なし |
| [2026-07-18-31](2026-07-18-31-fix-wa-sqlite-exact-version-pin.md) | M29 | wa-sqlite依存を完全固定バージョンへ変更 | 🟢低（1pt） | 🟡軽微（package-lock.jsonが既に事実上固定。npm ci運用なら実害小） |
| [2026-07-18-36](2026-07-18-36-feat-automate-third-party-notices.md) | M28 | THIRD_PARTY_NOTICESを自動生成する仕組みをCIに導入 | 🔴高（3pt） | 🟢なし |

DX・保守性:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-33](2026-07-18-33-feat-message-protocol-versioning.md) | L11 | Content-SWメッセージプロトコルにprotocolVersionを追加 | 🔴高（3pt） | 🟢なし |
| [2026-07-18-34](2026-07-18-34-fix-log-source-auto-completion.md) | L12 | ログ呼び出しのsourceパラメータ自動補完ヘルパー導入 | 🟡中（2pt） | 🟢なし |
| [2026-07-18-35](2026-07-18-35-fix-barrel-reexport-deprecation-notice.md) | L15 | バレル再エクスポート層に@deprecated JSDocを追加 | 🟢低（1pt） | 🟢なし |

UI・ドキュメント:
| PBI | 元指摘 | タイトル | 難易度 | 副作用 |
|---|---|---|---|---|
| [2026-07-18-13](2026-07-18-13-fix-popup-width-responsive.md) | L1 | ポップアップ幅の固定値をレスポンシブ対応に変更 | 🟢低（1pt） | 🟢なし |
| [2026-07-18-15](2026-07-18-15-feat-readme-architecture-and-privacy-section.md) | L2/L3 | READMEにアーキテクチャ図とプライバシー機能セクションを追加 | 🟡中（2pt） | 🟢なし |

---

## アーカイブ

完了済みPBIは [archive/](archive/) に移動する。運用手順は各PBIスキルのライフサイクル節を参照。

今回アーカイブ済み（実装完了確認済み）:
- 2026-07-13-03-fix-sqlite-history-panel-deepening.md
- 2026-07-16-02-fix-architecture-knowledge-graph-findings.md
- 2026-07-16-04-fix-adr014-file-references.md
- 2026-07-16-05-fix-sqlite-message-type-unification.md
- 2026-07-16-06-fix-idb-fallback-subframe7536-migration.md
- 2026-07-16-07-decide-opfs-migration-v2-removal.md
- 2026-07-17-08-dashboard-opfs-migration-status.md
- 2026-07-17-09-feat-audit-log-tsv-download.md

## 集計

| 状態 | 件数 |
|---|---|
| ⬜ 未着手 | 26 |
| アーカイブ済み | 32 |
| **合計（archive除く）** | 26 |
