# PBI: service-worker.ts（654行、5責務混在）を薄いエントリポイントに分割する

**作成日**: 2026-07-26
**優先度**: High
**見積もり**: 🔴高（3pt以上目安、Epic規模の可能性あり）
**副作用**: 🔴あり（拡張機能の起動シーケンス・全メッセージルーティングに関わる根本的な構造変更。誤ればあらゆる機能が動作不能になるリスク）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Maintainability Guardian, Refactoring Evangelist（重複）からの High指摘。`src/background/service-worker.ts`（全654行）に初期化・マイグレーション・メッセージルーティング・オフラインキュー処理・セッション管理・コンテキストメニュー登録・バッジ更新・プライバシーパイプライン——少なくとも5つ以上の責務が1ファイルに混在している。新機能追加時の変更影響範囲が大きく、merge conflictのリスクが高い。

**2026-07-26時点で `service-worker.ts` は654行のままであることを確認した（レビュー時と同じ行数、対応が行われていない）。**

既存PBI `2026-07-25-35-fix-service-worker-state-persistence.md`（状態永続化）、`2026-07-25-36-refactor-service-worker-singleton-di.md`（シングルトンDI化）が同じファイルの別側面（状態管理・依存性注入）を対象にしているため、本PBIはそれらと合わせて「ファイル分割」という第三の軸として設計する必要がある。3つのPBIが同一ファイルに競合する変更を加えることになるため、実施順序の調整が重要。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
wc -l src/background/service-worker.ts
grep -n "^function\|^export function\|^async function\|registry.register" src/background/service-worker.ts
```

**このPBIは既存PBI-35（状態永続化）・PBI-36（シングルトンDI）と同一ファイルを対象とするため、実施順序を計画すること。** 推奨順序: (1) 本PBI（ファイル分割、責務ごとにモジュール抽出）→ (2) PBI-36（分割後の各モジュールでDI導入）→ (3) PBI-35（状態永続化、分割後の該当モジュールに適用）。ファイル分割を先に行うことで、後続の変更が654行の巨大ファイルではなく責務ごとの小さいファイルに対して行えるようになる。

## 受け入れ基準（BDD）

```gherkin
Scenario: 初期化オーケストレーターが独立モジュールになる
  Given service-worker.ts の init() 関数（マイグレーション・アラーム登録等）
  When src/background/serviceWorkerInit.ts 等に抽出する
  Then service-worker.ts からは1行の呼び出しのみで初期化が行われる

Scenario: メッセージルーティングが独立モジュールになる
  Given service-worker.ts のメッセージハンドラー登録処理
  When src/background/messageRouter.ts 等に抽出する
  Then 新規メッセージタイプ追加時、service-worker.ts本体を編集する必要がない

Scenario: オフラインキュー処理が独立モジュールになる
  Given processOfflineNetworkQueue() 等のオフラインキュー関連処理
  When 既存の src/background/pendingSqliteQueue.ts 等と並ぶ専用モジュールに抽出する
  Then service-worker.ts はイベントリスナー登録のみを行う

Scenario: 分割後もextension全体の機能が回帰しない
  Given 責務ごとに分割されたservice-worker.ts
  When 実Chromeブラウザで拡張機能を読み込み、記録・AI要約・Obsidian連携・オフラインキュー・診断パネル等の全機能を確認する
  Then 全て分割前と同じように動作する

Scenario: 既存の全テストが回帰しない
  Given 分割後のコード
  When 既存のservice-worker関連テスト（全て）を実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `service-worker.ts` の654行を5つの責務（初期化オーケストレーター、メッセージルーティング、オフラインキュー監視、ライフサイクル/タブイベント、その他）に分類する
- [ ] 最も分離しやすい責務（例: オフラインキュー処理）から独立モジュールへの抽出を開始する
- [ ] `service-worker.ts` 本体はイベントリスナー登録と各モジュールの呼び出しのみを行う薄いエントリポイントにする
- [ ] 既存の全 `service-worker` 関連テストがパスする
- [ ] 実Chromeブラウザで全機能（記録・AI要約・Obsidian連携・診断パネル・オフラインキュー）が回帰しないことを確認する

## テスト戦略（t_wadaスタイル）

### 統合テスト
- 分割後、記録フロー全体（Content Script→Service Worker→AI要約→Obsidian書き込み）が回帰しないことを確認
- メッセージルーティングの全メッセージタイプが正しくハンドラーに到達することを確認

### 単体テスト
- 各抽出モジュール（初期化、メッセージルーティング等）が独立してテスト可能であることを確認
- 既存のservice-worker.test.tsが全てパスする（モジュール抽出に応じてテストファイルも分割することを検討）

### E2Eテスト（最小限、必須）
- 実ブラウザで拡張機能を読み込み、主要機能一式が動作することを確認（`AGENTS.md` Manual Testing Required に従う）

## 実装アプローチ

1. `service-worker.ts` の654行を機能ブロックごとに読み、5つの責務に分類する設計をまず行う（ADRとして記録することを推奨）
2. 最も依存が少ない責務（例: オフラインキュー処理）から段階的にモジュール抽出を開始
3. 各抽出のたびに既存テストとビルドを確認
4. 全ての抽出が完了したら `service-worker.ts` が薄いエントリポイントになっていることを確認
5. 実ブラウザでの最終動作確認

## 見積もり

Epic規模（5pt以上を想定）。既存PBI-35, PBI-36との実施順序調整が必須。段階ごとに分割PRとすることを強く推奨する。

## 技術的考慮事項
- 依存関係: `src/background/service-worker.ts` 全体、既存PBI-35（状態永続化）・PBI-36（シングルトンDI）との実施順序調整
- テスタビリティ: 分割後の各モジュールが独立してテスト可能になることが主目的の一つ
- 非機能要件: 保守性、Service Workerライフサイクル対応

## Definition of Done
- [ ] 5つの責務に分類する設計がADRとして記録されている
- [ ] 少なくとも1つの責務（推奨: オフラインキュー処理）の抽出が完了している
- [ ] 既存テストが全てパスする
- [ ] 実ブラウザでの動作確認が完了している
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Maintainability Guardian, Refactoring Evangelist指摘、High、重複統合）
- 対象コード: `src/background/service-worker.ts`（654行）
- 関連PBI（同一ファイル対象、実施順序要調整）: `2026-07-25-35-fix-service-worker-state-persistence.md`, `2026-07-25-36-refactor-service-worker-singleton-di.md`
