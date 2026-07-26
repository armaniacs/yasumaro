# PBI: 記録パイプライン全体にtraceIdを導入しログを串刺しで追跡可能にする

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🟡軽微（全パイプラインステップのログ出力にtraceId引数を追加するため変更箇所は広いが、ログ出力の追加のみで既存ロジックには影響しない）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の SRE/Ops Specialist からの指摘。`src/background/pipeline/RecordingPipeline.ts:278-306`（現状の行番号は前後する可能性あり）で、Content Script → Service Worker → RecordingPipeline（~12 steps）→ Offscreen（SQLite）→ AI API → Obsidian API を串刺しにするトレース/コリレーションIDが存在しない。エラー発生時の特定が困難。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "traceId\|correlationId" src/background/pipeline/RecordingPipeline.ts src/background/pipeline/steps/*.ts
ls src/background/pipeline/steps/
```

パイプラインの12ステップ全ての構造を確認し、`RecordingContext`（各ステップ間で受け渡されるコンテキストオブジェクト）に `traceId` を追加できる設計になっているか確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 記録処理開始時にtraceIdが発行される
  Given Content Scriptから記録リクエストが送信される
  When RecordingPipelineが処理を開始する
  Then 一意のtraceId（UUID等）が発行され、RecordingContextに格納される

Scenario: 全パイプラインステップのログにtraceIdが含まれる
  Given traceIdが発行された記録処理
  When 各ステップ（重複チェック、AI要約、SQLite保存、Obsidian書き込み等）でログが出力される
  Then 全てのログエントリに同一のtraceIdが含まれる

Scenario: エラー発生時にtraceIdで関連ログを追跡できる
  Given ある記録処理の途中でエラーが発生する
  When そのtraceIdでログを検索する
  Then その記録処理に関連する全てのログ（開始から失敗までの一連）が特定できる
```

## 受け入れ基準
- [x] `RecordingContext`（またはパイプラインの共通コンテキスト型）に `traceId` フィールドを追加する
- [x] パイプライン開始時（`RecordingPipeline.ts` の実行開始箇所）で一意のtraceIdを発行する
- [x] 各ステップ（`src/background/pipeline/steps/` 配下の全ファイル）のログ出力（`addLog` 呼び出し）にtraceIdを含める
- [ ] Offscreen・AI API呼び出し・Obsidian API呼び出しのログにもtraceIdを伝播させる（別途対応）
- [x] 既存のパイプライン関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- パイプライン開始時にtraceIdが発行されRecordingContextに格納されることを確認
- 各ステップのログ出力にtraceIdが含まれることを確認

### 統合テスト
- 記録処理全体を実行し、生成される全ログエントリが同一のtraceIdを持つことを確認
- エラーケースでも一連のログがtraceIdで追跡可能であることを確認

## 実装アプローチ

1. `RecordingContext` 型に `traceId: string` を追加
2. パイプライン開始箇所（`RecordingPipeline.ts`）でtraceId発行処理を追加（`crypto.randomUUID()` 等を使用）
3. 各ステップの `addLog()` 呼び出しにtraceIdを渡すよう変更（12ステップ全てに影響するため段階的に進める）
4. Offscreen・AI API・Obsidian API呼び出し時にもtraceIdをメッセージ/リクエストに含める
5. テスト追加

## 見積もり

3pt以上（12ステップ全てへの変更 + Offscreen/AI/Obsidian連携部分への伝播）。規模が大きいため、まずコンテキストへの追加とコアパイプラインステップへの適用を先行し、Offscreen/外部API連携は別PBIとして分割することも検討する。

## 技術的考慮事項
- 依存関係: `src/background/pipeline/RecordingPipeline.ts`, `src/background/pipeline/steps/*.ts`, `src/utils/logger.ts`
- テスタビリティ: 既存のパイプラインテストが土台
- 非機能要件: 可観測性（SRE/Ops）

## 実装進捗メモ（2026-07-27）

- `RecordingContext` に `traceId?: string` を追加。
- `RecordingPipeline.executeInternal()` 開始時に `crypto.randomUUID()` で traceId を発行し、初期 context に設定。
- `LogEntry` に `traceId?: string` を追加。`addLog()` は details 内の `traceId` をトップレベルに抽出して保存。
- `src/background/pipeline/steps/` 配下11ファイルの35箇所の `addLog()` 呼び出しに `traceId: context.traceId` を追加。
- `SaveSqliteStepParams` / `saveSqliteStep` に `traceId` を追加し、RecordingPipeline から渡すように変更。
- テストを追加:
  - `logger-enhanced.test.ts`: `addLog` が details 内の `traceId` をトップレベルに抽出すること
  - `RecordingPipeline.test.ts`: パイプライン開始時に traceId が発行され、全ステップのログに同一の traceId が含まれること
- `npm run validate` 成功（7285 passed / 18 skipped）。

### 未実施（別途対応）

AI Provider（`src/background/ai/providers/*`）、`ObsidianClient`、`SqliteClient` → Offscreen 間のログへの traceId 伝播は、これらのコンポーネントが `RecordingContext` を持たないため、メソッドシグネチャの拡張または専用ログコンテキストの導入が必要。PBI 本文の「Offscreen/外部API連携は別PBIとして分割することも検討する」に従い、本段階ではコアパイプラインのログ相関を優先。

## Definition of Done
- [x] RecordingContextにtraceIdが追加されている
- [x] 主要なパイプラインステップのログにtraceIdが含まれている
- [x] 既存テストが全てパスする
- [x] `pbi/00-INDEX.md` が更新されている（部分実装として記録）

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（SRE/Ops Specialist指摘）
- 対象コード: `src/background/pipeline/RecordingPipeline.ts:278-306`, `src/background/pipeline/steps/`
