# PBI 01: 記録結果の outcome ポリシーを RecordingOutcome に集約

優先度: 1 位 / RICE 26.7 = (10 × 2 × 80%) / 0.6w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch3.md](2026-09-05-00-backlog-arch3.md)
依存: なし（他 6 件と独立。RICE 順がそのまま実行順）

## ユーザーストーリー
記録パイプラインを保守する開発者として、失敗時の outcome 決定（PrivatePage / Duplicate / FATAL / RETRY マッピング＋ pending 登録＋通知）が 1 つの outcome ポリシーに集約されてほしい。なぜなら判定は `RecordingOrchestrator.executeInternal` の catch（:263-279）に、構築＋隠れた書き込み（`addPendingPage`・通知）は `resultBuilder.ts` に分散し、`build*` + `notify*` のペアリング知識が呼び出し側に漏れているから。

## BDD受け入れシナリオ

```gherkin
Scenario: PrivatePage エラーは pending 登録も通知もなく結果だけ返す
  Given privacyHeaders ステップが PrivatePageError を投げる
  When  decideOutcome を実行する
  Then  buildPrivatePageResult 相当の結果が返る
  And   pending 登録も通知も行われない

Scenario: FATAL エラーは pending 登録＋通知＋エラー結果の3点セットになる
  Given いずれかの FATAL ステップが Error を投げる
  When  decideOutcome を実行する
  Then  エラー結果が返る
  And   pending に reason=pipeline-error で登録される
  And   通知アダプタが1回呼ばれる

Scenario: Duplicate は成功・スキップ扱いで副作用なし
  Given duplicate ステップが DuplicateError を投げる
  When  decideOutcome を実行する
  Then  { success: true, skipped: true, reason } が返る
  And   pending 登録も通知も行われない
```

## 受け入れ基準
- [x] `executeInternal` の catch 内 `if PrivatePage / if Duplicate / if FATAL` 分岐が `decideOutcome` 1 呼び出しになる
- [x] `buildErrorResult` の隠れた副作用（`logError` + `void addPendingPage` :38-53）が outcome モジュール内に移動し、「pure」コメントの虚偽が解消される
- [x] 通知（`notifyRecordingError` / `notifyObsidianSaveSuccess`）と pending 書き込みが注入アダプタ経由になり、chrome・storage スタブなしでテストできる
- [x] preview 短絡・retry サブセット・フル実行の全経路が同一ポリシーを使う（`retryObsidian` 内の `notifyObsidianSaveSuccess` 直接呼び出し :200/:230 もポリシー経由に）
- [x] 既存 pipeline suite が green（`RecordingPipeline.test.ts` 等）

## テスト戦略（t_wadaスタイル）
### 単体テスト
- `decideOutcome` に thrown 値 × ステップ記述子のマトリクスを直に投入（in-memory の通知/pending フェイク）
- ペアリング回帰: FATAL 時に「結果＋pending＋通知」が原子的に起きることを1テストで検証
### 統合テスト
- `executeInternal` 経由の既存テストは無修正で green（外部振る舞い不変）
### 例外ハンドリング
- BEST_EFFORT 継続パス（`context.errors.push` :271-277）は対象外・現状維持

## 実装アプローチ
- **Outside-In**: `decideOutcome(thrown, step, context)` のシグネチャとアダプタ（Notifier / PendingWriter）から設計 → catch 本体を置換 → resultBuilder の副作用を移動

## 見積もり
0.6w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 通知・pending をコンストラクタ注入（prod は chrome + storage、テストは in-memory）
- 非機能要件: 挙動変更は禁止（リファクタリング）。通知文・pending reason 文字列は不変

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "PrivatePageError|DuplicateError|buildErrorResult|notifyRecordingError|addPendingPage" src/background/pipeline/RecordingOrchestrator.ts src/background/pipeline/resultBuilder.ts
```
2026-09-05 時点: catch 分岐 3 つ（:264-270）、`buildErrorResult` 内に `logError`（:39）と `void addPendingPage`（:46）、`buildResult` 内にも `void addPendingPage`（:97、obsidian_sync 時）。`notifyRecordingError` は chrome.notifications を直接触る（:68-76）。

### 実装手順
1. `src/background/pipeline/recordingOutcome.ts` を新設: `decideOutcome` + `Notifier` / `PendingWriter` アダプタ型
2. catch 本体 3 分岐を `decideOutcome` 呼び出しに置換
3. `buildErrorResult` / `buildResult` の副作用を outcome 側へ移動（resultBuilder は純粋構築のみに）
4. `retryObsidian` / `retryObsidianWrite` の通知呼び出しをポリシー経由に統一
5. 既存テスト green → 新規マトリクステスト追加

### 落とし穴
- `buildErrorResult` のコメントは「pure」と主張するが実際は副作用あり — コメントも同時に修正すること
- Duplicate の早期リターン形状（:265）は `buildResult` 形状と微妙に異なる（`skipped/reason`）。ポリシー内で明示的に分岐し、潰さないこと
- `previewOnly` 短絡（:262）は outcome 対象外。触らないこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] pipeline 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS §8.3 の Recording Pipeline 節に outcome seam を追記）
