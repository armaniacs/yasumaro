# 設計: 完全ローカルモード（クラウド送信ゼロ保証）

- 元PBI: [dev-docs/plans/2026-07-04-12-feat-strict-offline-mode.md](../../../dev-docs/plans/2026-07-04-12-feat-strict-offline-mode.md)
- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 依存: [PBI #06 記録漏れの検知とリカバリ通知](2026-07-05-missed-record-recovery-design.md)（pending機構の拡張が前提）

## 背景・現状分析

PBIは「厳格オフラインモード」という新機能の追加を想定していたが、コードを調査した結果、既存の `local_only` モードは**既にコードパスとしてクラウドに到達しない設計になっている**ことが判明した。

`src/background/privacyPipeline.ts` の `_buildSanitizedSettings()`（140-146行目）:

```typescript
useCloudAi: this.mode !== 'local_only',
```

`local_only` では `useCloudAi` が常に `false` になるため、L131-135のクラウド呼び出し（`this.aiClient.generateSummary()`）自体に到達しない。単一ゲートで保証されており、「1経路でもクラウドに漏れると信頼を失う」というPBIの懸念に対しては、既存実装は既に安全である。

したがって本PBIのスコープは「新モードの追加」ではなく、**既存 `local_only` の未実装だった欠落挙動を埋めること**に変わる。

### 発見した欠落：ローカルAI失敗時の扱い

`_performLocalSummarization()`（148-194行目）で、ローカルAIが失敗した場合（`localResult.success === false`、176行目）、現状は空オブジェクト `{}` を返して処理を継続する。その後 `generateSummary()`（親メソッド、131-137行目）で `useCloudAi` が `false` のためクラウドにも行かず、最終的に137行目の `return { summary: 'Summary not available.', ... }` に到達し、**「要約なし」のまま記録が完了してしまう**。

PBIの受け入れ基準「ローカルAI不可時はpending保持し、ユーザーに設定を促す」はこの経路で未実装。ユーザーは記録が失敗したことに気づけない。

## 対象スコープ

1. **クラウド非到達の保証をテストで積極的に証明する**（現状のコードは正しいが、退行を防ぐテストが不足）
2. **`local_only` でローカルAIが利用不可・失敗した場合、pendingに登録して再記録を促す**（PBI #06のpending機構を拡張）
3. **設定UIでのクラウドプロバイダー選択ガード**（`local_only` 選択中はクラウドプロバイダー関連設定を無効化する視覚的フィードバック）
4. **モード状態の明示表示**（現在 `local_only` で動作中であることをダッシュボード/ポップアップで分かるようにする）

新モード（例: `strict_offline`）は追加しない。`local_only` の意味を「クラウド送信ゼロ保証モード」として確定させる。

## データ設計

PBI #06 で `PendingPage.reason` に `'pipeline-error' | 'obsidian-write-failed'` が追加される前提のもと、本PBIでさらに `'local-ai-unavailable'` を追加する。

```typescript
export interface PendingPage {
  url: string;
  title: string;
  timestamp: number;
  reason: 'cache-control' | 'set-cookie' | 'authorization'
    | 'pipeline-error' | 'obsidian-write-failed'  // PBI #06 で追加
    | 'local-ai-unavailable';                      // 本PBIで追加
  headerValue?: string;
  expiry: number;
  errorMessage?: string;  // PBI #06 で追加
}
```

TTL・件数上限は既存の pending 機構の方針（24時間、上限なし）をそのまま踏襲する。

## コンポーネント設計

### 1. `src/background/privacyPipeline.ts`（拡張）
- `_performLocalSummarization()`内、ローカルAI失敗時（176-178行目、`!localResult.success || !localResult.summary` の分岐）に、`this.mode === 'local_only'` の場合のみ `returnEarly: true` とし、`addPendingPage({ reason: 'local-ai-unavailable', ... })` を呼んだ上で記録全体を失敗として扱う
- `local_only` 以外のモード（`full_pipeline` 等）でローカルAIが失敗した場合は、既存通りクラウドにフォールバックする（この経路は変更しない）
- 呼び出し元（`generateSummary()` / `RecordingPipeline`）にエラーとして伝播させる必要があるため、`PrivacyPipelineResult` に失敗を表すフィールド（例: `success: false`）を追加するか、例外を投げて `RecordingPipeline.buildErrorResult()`（PBI #06 で pending 登録済み）に処理を委譲する設計とする。後者（例外を投げて既存のFATAL失敗経路に乗せる）の方が `RecordingPipeline` 側の変更が不要で一貫性が高いため、こちらを採用する

### 2. `src/dashboard/historyFilters.ts`（拡張）
- PBI #06 で追加される `renderPendingReason()` に `'local-ai-unavailable'` のケースを追加（表示ラベル: 「ローカルAI利用不可」）

### 3. 設定UIガード（`src/popup/privacySettings.ts` 拡張）
- `local_only` が選択されている間、クラウドプロバイダー関連の設定項目（AIプロバイダー選択、APIキー入力等）を `disabled` にし、視覚的にグレーアウトする
- ラジオボタンの `change` イベントで即座に反映する（保存前のプレビュー的な挙動）

### 4. モード状態の明示表示
- ポップアップまたはダッシュボードの既存ステータス表示箇所（`src/popup/statusPanel.ts` 等）に、現在のプライバシーモードを表示するバッジ・テキストを追加する

## エラーハンドリング

| ケース | 挙動 |
|---|---|
| `local_only` でローカルAI利用不可（`getAvailability()` が `readily` 以外） | pending登録（`local-ai-unavailable`）し、記録全体を失敗として扱う（PBI #06 の再記録UIで回復可能） |
| `local_only` でローカルAI要約が例外を投げる | 同上 |
| `local_only` 以外でローカルAI失敗 | 既存通りクラウドにフォールバック（変更なし） |

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `_performLocalSummarization()`: `local_only` かつローカルAI失敗時に例外を投げること（またはエラー結果を返すこと）
- `local_only` 以外のモードでは同条件でもクラウドフォールバックが発生すること（既存動作の回帰確認）

### 統合テスト
- **クラウド非到達の積極的証明**: `local_only` モードで記録を実行した際、`aiClient.generateSummary()`（クラウド呼び出し）が一度も呼ばれないことをスパイでアサートする
- `local_only` でローカルAI不可時、pendingに `local-ai-unavailable` として登録されること
- 設定UIで `local_only` 選択時にクラウドプロバイダー関連フィールドが `disabled` になること

### E2Eテスト
- `local_only` 選択 → ローカルAI利用不可の状態で記録 → pending一覧に表示 → ローカルAI復旧後に再記録 → 成功
- `local_only` 選択 → 設定画面でクラウドプロバイダー選択がガードされていることを確認

## 実装アプローチ

Outside-In / Red-Green-Refactor。「クラウドに到達しない」ことの統合テスト（スパイアサーション）から着手し、次にローカルAI失敗時のpending化、最後に設定UIガードとモード表示を実装する。

## 技術的考慮事項

- 依存: **PBI #06 の実装が先行している必要がある**（`PendingPage.reason` 拡張・pending登録パターンを再利用するため）
- 再利用: `src/background/localAiClient.ts`（`getAvailability` / `summarize`。PBI原文の `getLocalAvailability`/`summarizeLocally` という関数名は実装と異なるため注意）、`src/utils/pendingStorage.ts`、`src/background/privacyPipeline.ts`
- 実装順序: 本PBIは00-index.mdの提案順で#06の直後に位置しており、依存関係と整合する

## スコープ外（YAGNI）

- 新規モード（`strict_offline` 等）の追加は行わない
- `masked_cloud` モードへの厳格化適用（本PBIは `local_only` のみが対象）

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] クラウド非送信をテストで積極的に証明する
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
