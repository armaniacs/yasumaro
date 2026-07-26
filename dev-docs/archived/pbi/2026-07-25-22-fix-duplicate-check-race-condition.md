# PBI: 重複URLチェックのread-then-writeレース条件を排他制御で防ぐ

**作成日**: 2026-07-25
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（既存のMutex実装を流用するが、パイプラインステップに排他区間を追加するため処理順序に影響する可能性がある）

## 実装メモ（2026-07-26）

`RecordingPipeline.ts` にURL単位のMutexマップ（`urlMutexes: Map<string, Mutex>`）を追加。
既存の `Mutex`（`src/background/Mutex.ts`）を再利用。`execute()` の既存ロジックを `executeInternal()` に
切り出し、外側の `execute()` でURL単位のMutex取得→`executeInternal()`実行→`finally`でのMutex解放を行う。
ロック解放時、待機キューが空かつロック解除済みならマップからエントリを削除し、無制限な増加を防ぐ。

ロック粒度は「パイプライン全体（checkDuplicateStep〜saveMetadataStepを含む）」を選択（PBIが示した2択のうち
「記録処理全体」）。同一URLへの2件目は1件目の完了（AI要約・Obsidian書き込み等を含む全処理）を待ってから
実行される。異なるURLは互いにブロックしない。

`src/background/pipeline/__tests__/RecordingPipeline.test.ts` に2件の並行実行テストを追加（直列化確認・
異なるURL独立確認）。全25件パス（既存のflaky timeoutテストも今回は正常完了）。

---

## 背景

Checking Team レビュー（2026-07-25）の Domain Logic Expert からの指摘。`src/background/pipeline/steps/checkDuplicateStep.ts:1-70` は `getSavedUrlsWithTimestamps()`（storageの読み取り）に基づいて重複判定を行うが、この読み取りと、後続処理での保存（書き込み）の間に排他制御（Mutex等）がない。複数タブ・複数リクエストが並行実行された場合、read-then-writeの間にレース条件が生じ、同一URLが重複して記録される可能性がある。

プロジェクトには `src/background/Mutex.ts` が既に実装されており、他の箇所で競合制御に使われている前例がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "class Mutex\|acquire\|release" src/background/Mutex.ts
grep -rn "new Mutex()" src/background/
grep -n "checkDuplicateStep\|getSavedUrlsWithTimestamps" src/background/pipeline/steps/checkDuplicateStep.ts src/background/pipeline/RecordingPipeline.ts
```

パイプライン全体（`RecordingPipeline.ts`）で既にリクエスト単位のMutexが取得されていないか確認する。もし既に上位レイヤーで排他制御されていれば、このPBIは不要または縮小できる。

## 受け入れ基準（BDD）

```gherkin
Scenario: 同一URLへの並行記録リクエストが直列化される
  Given 同一URLに対する2つの記録リクエストがほぼ同時に発生する
  When 両方が checkDuplicateStep を通過しようとする
  Then 一方が完了（保存）するまで、もう一方の重複チェックは待機する

Scenario: 排他制御後、2件目のリクエストは重複として検出される
  Given 1件目のリクエストが保存を完了した
  When 2件目のリクエストの重複チェックが実行される
  Then 2件目は DuplicateError('same_day') として検出される

Scenario: 異なるURLへの並行リクエストは排他制御の影響を受けない
  Given 異なる2つのURLへの記録リクエストが同時に発生する
  When 両方が checkDuplicateStep を通過する
  Then 両方とも重複判定されず正常に処理が進む（URLごとの粒度でロックする、または全体ロックでも許容範囲のレイテンシに収まることを確認）
```

## 受け入れ基準
- [ ] `checkDuplicateStep` の重複チェック〜保存までの区間を、既存の `Mutex` クラスで排他制御する
- [ ] ロック粒度は「URL単位」または「記録処理全体」のいずれかを選択し、性能とのトレードオフを見積もりに明記する
- [ ] 既存の重複チェック関連テストが全てパスする
- [ ] 並行リクエストシナリオでの重複記録が発生しないことを確認するテストを追加する

## テスト戦略（t_wadaスタイル）

### 単体テスト
- Mutexが正しく取得・解放されることを確認
- 同一URLの並行呼び出しで一方が待機することを確認

### 統合テスト
- `Promise.all` で同一URLへの複数記録リクエストを並行実行し、実際に保存される件数が1件であることを確認するテストを追加

## 実装アプローチ

1. `checkDuplicateStep` またはパイプライン全体に `Mutex` を導入する箇所を決定
2. ロック粒度（URL単位 vs グローバル）を検討し実装
3. 並行実行テストを追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/background/Mutex.ts`
- テスタビリティ: `Promise.all` を使った並行実行テストで再現可能
- 非機能要件: データ整合性

## Definition of Done
- [ ] 排他制御が実装されている
- [ ] 並行実行での重複記録防止がテストで確認されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Domain Logic Expert指摘、「重複チェックのタイミング」Low項目と統合）
- 対象コード: `src/background/pipeline/steps/checkDuplicateStep.ts`, `src/background/Mutex.ts`
