# 設計: SyncTarget抽象化 + GitHub Gist出力先

- 元PBI: [dev-docs/plans/2026-07-04-08-feat-sync-target-abstraction.md](../../../dev-docs/plans/2026-07-04-08-feat-sync-target-abstraction.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 見積もり: Epic級（13pt）。本ドキュメントは設計方針のみを固め、実装計画（writing-plans）はタスク単位に分割して着手する

## 背景・現状分析とスコープ変更の経緯

PBI原文は新規出力先としてNotion / Readwiseを例示していたが、検討の結果、両者は以下の理由で最初の実装対象として最適ではないと判断した。

- **Notion**: ページ/データベースという構造化モデルへのマッピング設計が必要で、実装コストが高い
- **Readwise**: 読書ハイライト管理に特化したAPIであり、ブラウジング履歴という性質との相性が不明瞭

代わりに **GitHub Gist** を最初の新規出力先として採用する。理由：
- Personal Access Token 一つで認証が完結し、OAuthフロー実装が不要
- 出力形式がMarkdownファイルであり、既存の `src/background/pipeline/steps/formatMarkdownStep.ts` のMarkdown生成ロジックをほぼそのまま流用できる
- ページ/データベース等の構造設計が不要で、`SyncTarget` インターフェースの最小実装例として適している

## 対象スコープ

1. `SyncTarget` インターフェースを定義する
2. 既存 `ObsidianSyncService`（`src/background/obsidianSyncService.ts`）を `SyncTarget` 実装としてリファクタリングする（新規インターフェースの後付けラッパーではなく、クラス自体がインターフェースに準拠する形にする）
3. GitHub Gistを新規 `SyncTarget` 実装として追加する
4. 複数出力先を独立して有効化・失敗分離できるようにする（Obsidianの送信失敗がGistへの送信を妨げない、逆も同様）

## アーキテクチャ

```
[SyncTarget interface]  src/background/syncTargets/SyncTarget.ts
  - isConfigured(): Promise<boolean>
  - sync(logId, url, title, summary): Promise<boolean>
  - syncBatch(): Promise<number>
  - testConnection(): Promise<{ success: boolean; message: string }>

[既存実装のリファクタ] src/background/obsidianSyncService.ts
  - ObsidianSyncService implements SyncTarget（既存メソッドシグネチャを維持したまま implements を追加）

[新規実装] src/background/syncTargets/gistSyncTarget.ts
  - GistSyncTarget implements SyncTarget
  - Markdown生成: formatMarkdownStep.ts のロジックを再利用（関数を共通化して両者から呼べるようにする）
  - GitHub REST API（POST /gists）でGist作成・更新

[調整役] src/background/syncTargetRegistry.ts（新規）
  - 有効化されている SyncTarget 実装の一覧を settings から解決する
  - 各ターゲットへの sync() を Promise.allSettled で並行実行し、一つの失敗が他に影響しないようにする
```

## データ設計

- 新規 StorageKeys: `GIST_ENABLED`, `GITHUB_PAT`（暗号化対象。既存 `src/utils/crypto.ts` のAPIキー暗号化パターンに準拠）, `GIST_ID`（更新対象Gistの識別子。初回同期時に作成しstorageに保存、以降は同一Gistを更新）
- 同期先ごとの成否は既存の `context.errors`（`RecordingPipeline`）にステップ名を分けて積む方式を踏襲し、PBI #06のpending機構と自然に統合できるようにする

## エラーハンドリング

- 各 `SyncTarget.sync()` の失敗は他のターゲットに伝播させない（`syncTargetRegistry.ts` で `Promise.allSettled` により分離）
- Gist API のレート制限（GitHub API: 認証済みで5000リクエスト/時）を考慮し、既存の `RETRY` 戦略パターン（`RecordingPipeline` のステップ戦略）に倣ったリトライを実装する
- Gist作成失敗時、`GIST_ID` は更新しない（次回同期時に再度新規作成を試みる、または明示的なエラー表示でユーザーに再設定を促す）

## セキュリティ考慮事項

- GitHub PAT は `src/utils/crypto.ts` のPBKDF2+AES-GCM暗号化で保存する（既存のAPIキー暗号化と同一方式）
- Gist作成時のURL構築は `src/utils/urlUtils.ts` の既存バリデーション関数（`isSecureUrl` 等）のパターンに準拠し、SSRF対策を踏襲する
- 外部SaaSへの送信は既存のプライバシー同意フロー（PrivacyPipeline）を通過したコンテンツのみを対象とする（本文の生データではなく、要約・マスキング済みのMarkdownを送信する）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `SyncTarget` インターフェース準拠の型検証
- `GistSyncTarget.sync()`: Gist作成・更新のペイロード整形
- `syncTargetRegistry.ts`: 複数ターゲットの並行実行・片方失敗時の分離

### 統合テスト
- `ObsidianSyncService implements SyncTarget` へのリファクタ後、既存のObsidian同期テストが全てPASSすること（回帰確認）
- Obsidian + Gist 両方有効時、片方の失敗が他方に影響しないこと

### E2Eテスト
- Gistを新規有効化 → 記録 → Gistに履歴エントリが作成される
- Obsidian + Gist 両方有効 → 記録 → 両方に送信される

## 実装アプローチ

Epic級のため、以下のタスクに分割して段階的に実装する（各タスクは個別にwriting-plansで実装計画化する）：

1. **タスクA**: `SyncTarget` インターフェース定義 + `ObsidianSyncService` のリファクタ（新規出力先なし、既存動作の回帰がないことを確認するのみ）
2. **タスクB**: `GistSyncTarget` の実装（Markdown生成の共通化含む）
3. **タスクC**: `syncTargetRegistry.ts` による複数ターゲット管理・失敗分離
4. **タスクD**: 設定UI（Gist有効化・PAT入力・接続テスト）

タスクAが完了し既存機能に影響がないことを確認してから、タスクB以降に進む。

## 技術的考慮事項

- 依存: PBI #07（ローカルMarkdown出力）が完了済みのため、Markdown生成ロジックの共通化がしやすい状態にある
- 再利用: `src/background/obsidianSyncService.ts`（抽象化のベース）、`src/background/pipeline/steps/formatMarkdownStep.ts`（Markdown生成）、`src/utils/urlUtils.ts`（URL検証）、`src/utils/crypto.ts`（PAT暗号化）

## スコープ外（YAGNI）

- Notion / Readwise 連携（将来の別PBIとして再検討）
- Gist以外のGitHub連携（リポジトリへの直接コミット等）
- 出力先ごとのカスタムテンプレート機能

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
