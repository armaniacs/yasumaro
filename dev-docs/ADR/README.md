# ADR (Architecture Decision Records)

YasumaroプロジェクトのArchitecture Decision Record（ADR）一覧です。

## ADR一覧

| # | タイトル | 日付 | ステータス |
|---|---------|------|----------|
| 0001 | [APIキーセキュリティポリシー](./0001-api-key-security-policy.md) | 2026-03-01 | 採用済み |
| 0002 | [CSP 二層セキュリティモデル](./0002-csp-layered-security.md) | 2026-03-17 | 採用済み |
| 001 | [ポート移行からHTTPS経由のAPI呼び出しへ](./2026-02-22-port-migration-to-https.md) | 2026-02-22 | 採用済み |
| 003 | [プロジェクト名変更](./2026-02-25-rename-to-obsidian-weave.md) | 2026-02-25 | 採用済み（その後Yasumaroへ再改名、CHANGELOG参照） |
| - | [CICDは使用しない](./2026-03-01-CICD-is-not-use.md) | 2026-03-01 | 撤回済み（`.github/workflows/`でCI/CD稼働中） |
| - | [最適化されたコンテンツ抽出](./2026-03-01-optimized-content-extraction.md) | 2026-03-01 | 採用済み |
| - | [通知IDセキュリティ強化とログ出力のプライバシー保護](./2026-03-02-notification-id-security-and-log-privacy.md) | 2026-03-02 | 採用済み |
| - | [HMAC署名検証失敗時のユーザー確認によるインポート許可](./2026-03-03-user-override-for-hmac-verification-failure.md) | 2026-03-03 | 撤回済み（VULN-010対応で強制インポート機能を削除） |
| - | [手動保存後のAIタグ分類結果表示](./2026-03-12-show-ai-tags-after-manual-save.md) | 2026-03-12 | 採用済み |
| - | [CSP競合状態の修正](./2026-03-20-csp-race-condition-fix.md) | 2026-03-20 | 採用済み |
| - | [デフォルト設定の単一ソース化](./2026-03-20-default-settings-single-source.md) | 2026-03-20 | 採用済み |
| - | [TrustChecker統合](./2026-03-20-integrate-trustchecker.md) | 2026-03-20 | 採用済み |
| - | [マニフェストhost_permissions最小化](./2026-03-20-manifest-host-permissions-minimization.md) | 2026-03-20 | 採用済み |
| - | [PermissionManagerとTrustDb分離](./2026-03-20-permissionManager-trustDb-separation.md) | 2026-03-20 | 採用済み |
| - | [プロンプトインジェクションサニタイズ再評価修正](./2026-03-20-prompt-injection-sanitize-reeval-fix.md) | 2026-03-20 | 採用済み |
| - | [プロンプトサニタイザー過剰一致修正](./2026-03-20-prompt-sanitizer-over-matching-fix.md) | 2026-03-20 | 採用済み |
| - | [TrustDBアトミック性修正](./2026-03-20-trustdb-atomicity-fix.md) | 2026-03-20 | 採用済み |
| - | [TrustDB初期化Promise修正](./2026-03-20-trustdb-initpromise-fix.md) | 2026-03-20 | 採用済み |
| - | [マスターパスワードデータクリーンアップ](./2026-03-24-master-password-data-cleanup.md) | 2026-03-24 | 採用済み |
| - | [Models.devダイアログアクセシビリティ](./2026-03-24-models-dev-dialog-accessibility.md) | 2026-03-24 | 採用済み |
| - | [PermissionManager-TrustDb分離完了](./2026-03-24-permissionManager-trustDb-separation-completed.md) | 2026-03-24 | 採用済み |
| - | [Trancoリスト更新通知](./2026-03-24-tranco-list-update-notification.md) | 2026-03-24 | 採用済み |
| - | [RecordingResult.maskedItems型修正](./2026-03-25-recordingResult-maskedItems-type-fix.md) | 2026-03-25 | 採用済み |
| - | [LM Studio統合によるローカルAI対応](./2026-04-04-lm-studio-integration.md) | 2026-04-04 | 採用済み |
| - | [Ollama統合によるローカルAI対応](./2026-04-05-ollama-integration.md) | 2026-04-05 | 採用済み |
| 016 | [キーボード操作対応を実施しない](./2026-04-19-no-keyboard-operation-support.md) | 2026-04-19 | 提案中 |
| 013 | [Vite + crxjs から WXT への移行](./2026-04-19-wxt-migration.md) | 2026-04-19 | 実装済み |
| 015 | [AI Provider Abstraction Architecture](./2026-04-21-ai-provider-abstraction.md) | 2026-04-21 | 完了 |
| 014 | [OPFS永続化とFTS5全文検索の両立（@subframe7536/sqlite-wasm + trigram）](./2026-06-17-opfs-fts5-coexistence.md) | 2026-06-17 | 採用済み |
| - | [SQLite と chrome.storage の二重書き込みとクォータ対策](./2026-07-07-sqlite-chrome-storage-dual-write.md) | 2026-07-07 | 採用済み |
| - | [Deep Dig Findings — Architecture Phase 2](./2026-07-13-architecture-phase2-deep-dig.md) | 2026-07-13 | 調査記録 |
| - | [Deep Dig Findings — SQLite Architecture Deepening](./2026-07-13-sqlite-architecture-deep-dig.md) | 2026-07-13 | 調査記録 |
| - | [Markdown出力経路へのサニタイズ適用ルール](./2026-07-22-markdown-output-sanitization-guardrail.md) | 2026-07-22 | 承認済み |
| - | [Response Size Limit Guardrail](./2026-07-22-response-size-limit-guardrail.md) | 2026-07-22 | 承認済み |

---

# ADR標準フォーマット

以下は、YasumaroプロジェクトのADRで使用する標準フォーマットです。

## フォーマット構造

全てのADRは、次のセクションを含む必要があります：

```markdown
# ADR: [決定のタイトル]

## ステータス
[採用済み | 提案中 | 破棄 | 置換済み]

## 日付
YYYY-MM-DD

## 作成者
[名前]

## コンテキスト
[問題の背景、現在の状況、問題がなぜ重要か]

## 関連するADR
- [関連ADRへのリンク]

## 決定事項
[採用された決定] (Markdownの見出しレベルは##とする)

## 結果
[決定の結果、メリット、デメリット、影響範囲]

## 参照
[関連ドキュメント、外部リソース等]
```

## 各セクションのガイドライン

### ステータス
ADRの現在の状態を示します：
- **採用済み**: 実装済みで本番環境で使用中
- **提案中**: 検討・議論中
- **破棄**: 採用されなかった決定
- **置換済み**: 新しいADRにより置換された

### 日付
ADRが作成または更新された日付（ISO 8601形式: YYYY-MM-DD）

### コンテキスト
以下を含めることで検討の背景を明確にします：
- 現在の状況
- 課題や問題点
- 代替案の検討
- 影響を受けるステークホルダー

### 関連するADR
このADRに関連する他のADRをリストアップし、決定の文脈を明確化します。

### 決定事項
採用された決定を簡潔かつ明確に記述します：
- 何を採用したか
- なぜ採用したか
- 具体的な実装内容（必要に応じてコード例を含む）

### 結果
決定の実装と影響について記述します：
- **メリット**: 期待される利点
- **デメリット**: トレードオフや懸念点
- **影響範囲**: 変更されるコード、コンポーネント、プロセス
- **実装計画**: タイムライン、担当者（必要に応じて）

### 参照（オプション）
追加の情報を提供するドキュメントやリソース：
- 関連するGitHub Issue / PR
- 外部技術ドキュメント
- 関連する学術論文等

## ファイル命名規則

ADRファイルは `dev-docs/ADR/` ディレクトリに格納します：

```
YYYY-MM-DD-[決定のタイトルをkebab-caseにしたもの].md
```

例：
- `2026-03-01-api-key-security-policy.md`
- `2026-03-01-optimized-content-extraction.md`

## 置換されたADRの管理

ADRを置換する場合：
1. 元のADRの「ステータス」を「置換済み」に更新
2. 「関連するADR」に置換後のADRへのリンクを追加
3. 新しいADRの「関連するADR」に置換されたADRへのリンクを追加

## テンプレート

```markdown
# ADR: [タイトル]

## ステータス
採用済み

## 日付
YYYY-MM-DD

## 作成者
[名前]

## コンテキスト
[問題の背景を記述]

## 関連するADR
- なし

## 決定事項
[採用された決定を記述]

## 結果
### メリット
- [利点1]
- [利点2]

### デメリット
- [トレードオフ]

### 影響範囲
- [変更されるコンポーネント]

## 参照
- [関連リンク]
```