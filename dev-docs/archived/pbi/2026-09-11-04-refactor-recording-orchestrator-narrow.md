# PBI: RecordingOrchestrator の公開接口を 3 エントリに絞る

## ユーザーストーリー

開発者として、RecordingOrchestrator の公開接口が `record` / `preview` / `retryObsidianWrite` の 3 つだけであってほしい、なぜなら 5 通りの呼び方と非推奨の mode 共用体を覚える必要がなくなり、記録パイプラインの欠陥が 1 つの seam に集約されるから。

## 優先度

- 順位: 1 / 5
- RICEスコア: 40.0（Reach=25 / Impact=2 / Confidence=80% / Effort=1人日）
- 根拠: 5 候補中最高スコア。Effort 最小（ラッパー＋エイリアス削除と 3 呼び出し元の置換のみ）で記録パス全体の学習コストを下げる。Strong 判定。依存なしのため先行実施可。

## ビジネス価値

- 呼び出し側が覚える形状が 3 通りに固定され、新規参入者の誤用（`record(mode)` の mode 指定ミス、旧エイリアスへの残存参照）がなくなる
- 非推奨 `mode` 共用体の削除により、型レベルで不正な呼び出しがコンパイル時に落ちる
- 記録パイプラインの欠陥局所性が上がり、将来の変更が 1 seam 経由になる

## BDD受け入れシナリオ

```gherkin
Scenario: 通常記録は record 一経路で完走する
  Given 拡張機能が通常の記録要求を受け付けている
  When 呼び出し元が record を通常パラメータで呼ぶ
  Then 記録パイプラインが完走し Obsidian 書き込みまで到達する
  And  mode 引数なしで振る舞いが従来の通常記録と同一である

Scenario: 非推奨の呼び方は型・実行時に拒否される
  Given record(mode) ラッパーと retryObsidianWriteOnly エイリアスが削除されている
  When 既存の 3 呼び出し元が新 3 エントリのみでビルドされる
  Then 旧スペルへの参照が型チェックで検出される
  And Obsidian 書き込みリトライは retryObsidianWrite 経由でのみ発火する
```

## 受け入れ基準

- [x] 公開接口が `record` / `preview` / `retryObsidianWrite` の 3 つのみである（`orchestrator-surface.test.ts` で pin）
- [x] `record(mode)` ラッパーと `retryObsidianWriteOnly` エイリアスが削除されている（`rg` で 0 件確認）
- [x] `mode` 共用体型が公開型から消えている（`RecordMode` 削除・`rg` で 0 件確認）
- [x] 呼び出し元 3 件（recordingHandlers / offlineQueueProcessor / notificationHandlers）が新接口でビルド・テスト green（変更が必要だったのは offlineQueueProcessor のみ — 他 2 件は既に `record()` のみ使用）
- [x] `npm run type-check` と関連テストが green（type-check exit 0・関連 18 ファイル 324 passed）

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 通常記録フロー（record → Obsidian 書き込み）が従来通り完走すること

### 統合テスト

- 3 呼び出し元 × 3 エントリの配線テスト（preview は書き込みなし、retry は Obsidian 再書き込みのみ）

### 単体テスト

- 旧スペル参照の grep ガード（`retryObsidianWriteOnly` / `record(mode` の再発防止）
- mode 共用体削除後の型アサート（不正 mode でコンパイルエラー）

## 実装アプローチ

- **Outside-In**: 呼び出し元 3 件の期待配線テストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: ラッパー削除 → 呼び出し元置換 → 共用体削除の順で小刻みに green 化
- **リファクタリング**: green になるたびに公開型の export 棚卸し

## 見積もり

S（1人日。要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし（他 4 PBI とファイル非重複のはずだが、着手前に `grep -rn "retryObsidianWriteOnly\|record(mode" src/` で重複を確認）
- テスタビリティ: Orchestrator を seam 経由で差し替え可能にし、呼び出し元テストは fake で配線のみ検証
- 非機能要件: 振る舞い不変（記録・プレビュー・リトライの外部挙動は同一）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 旧スペルの残存箇所を探す
grep -rn "retryObsidianWriteOnly" src/
grep -rn "record(mode\|record<" src/background/pipeline/
grep -rn "RecordingOrchestrator" src/ --include="*.ts" -l
```

### 実装手順

1. `src/background/pipeline/RecordingOrchestrator.ts` の公開メソッド棚卸し（5 スペルを特定）
2. 呼び出し元 3 件の呼び出し箇所を新 3 エントリに置換
3. `record(mode)` ラッパーと `retryObsidianWriteOnly` エイリアスを削除
4. 非推奨 `mode` 共用体型を削除し、公開型を 3 エントリのみに
5. grep ガードテスト追加 → type-check → 関連テスト green

### 落とし穴

- offlineQueueProcessor のリトライ経路が旧エイリアスに依存している可能性 — 置換漏れは実行時ではなく型で検出すること
- `mode` 共用体を参照するテスト型がある場合、テスト側の型修正が必要になる

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする（`orchestrator-surface.test.ts` 新設 2 件 + 既存 324 green）
- [x] コードレビュー完了（自律レビュー: 旧スペル `rg` 0 件・呼び出し元全数確認）
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS §8.3 を 3 エントリに更新）
- [x] ロールバック手段の検討（git revert で可能・振る舞い不変のため feature flag 不要）

## 実装メモ（2026-09-11 autonomous-task-closer）

- 削除: `RecordMode` 型・`RecordOptions.mode`・`recordFull`（本体を `record()` に折り畳み）・private `retryObsidian`（`mode:'retryObsidian'` 経由の到達のみで dead）・`retryObsidianWriteOnly` alias。変更呼び出し元は `offlineQueueProcessor.ts`（型 + 呼び出し）のみ。
- `retryObsidianWrite-result.test.ts` の mode-path テスト 1 件を削除（削除した API の pin のため。振る舞い自体は `retryObsidianWrite` の既存 2 件で担保）。
- 維持の判断: `previewOnly` data フラグは残す — `executeInternal` の breakpoint・`processPrivacyPipelineStep`・10 超のテストが data 層 seam として依存し、PBI の削除対象（mode 共用体・ラッパー・alias）には含まれない。`record()` の preview 委譲は data/opts の previewOnly のみを見る。
- なぜなぜ: なぜ 5 通りの呼び方が生まれたのか → 後方互換のラッパーが「新接口」追加のたびに残置され、削除の責務がどの PBI にも無かった → 解: alias/wrapper を使う最後の呼び出し元（offlineQueue）を新スペルに寄せてから削除し、表面テストで再発を固定。
