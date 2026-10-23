# PBI: 記録可否判定の純粋核一本化

## ユーザーストーリー

保守担当者として、判定知識をgate table 1 moduleに寄せたい。なぜなら同一判定が4箇所に跨り、順序変更がtableとorchestratorの両読みを要求するから。

## 優先度

- 順位: 04 / 全8件
- RICE スコア: 7.2（Reach = 6 / Impact = 3 / Confidence = 0.8 / Effort = 2.0人日）
- 根拠: 優先順位変更コストの集中（Impact 3）。NN05 は本 PBI の後に実施（同orchestratorに触れるため）。

## ビジネス価値

優先順位・ verdict の変更がtable 1箇所で済み、型の並立が解消される。

## BDD受け入れシナリオ

```gherkin
Scenario: 判定が純粋核で動く
  Given 各種の記録条件がある
  When 判定する
  Then 変更前と同一の verdict が返る

Scenario: 優先順位変更が1箇所で済む
  Given 順序を変えたい
  When tableを変える
  Then 全体に反映される
```

## 受け入れ基準

- [ ] 純粋核がgate table 1 moduleに寄り、orchestratorは実行metadataのみ持つ
- [ ] stepがI/Oのみになり、content側がadapterに限定される
- [ ] 型の並立が解消される
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- pipeline経由の判定テスト維持

### 単体テスト
- gate tableのtableテスト（順序・verdict）

## 実装アプローチ

- **Outside-In**: 純粋核の失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

2pt（🟡中）

## 技術的考慮事項

- 依存関係: NN05 は本 PBI の後に実施（同orchestrator）
- 非機能要件: 判定結果・順序不変

## 変更点の概要

判定の純粋核をtableに寄せ、実行とI/Oを分離する。

## 現状と問題（file:line 付き）

- `src/utils/recordingGateTable.ts:191` ― TABLE 5行
- `src/background/pipeline/RecordingOrchestrator.ts:95-106` ― gateExecutors合成
- `src/background/pipeline/steps/checkPrivacyHeadersStep.ts:58-93` ― 2回decideGate
- `src/background/pipeline/recordingDecision.ts:33-97` ― 別verdict群
- `src/content/visitAdmission.ts:45`・`visitGating.ts:31-53`・`visitGate.ts:32-63` ― content側

## 変更の理由（depth・locality）

seam密結合と型並立。純粋核一本化で解く。

## 提案コード（骨子のみ）

```typescript
// decideGate/evaluateGates の単一interfaceを持つ純粋核。
// orchestratorは実行metadataのみ。stepはI/Oのみ。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "decideGate\|GateVerdict\|PrivacyDecision" src/background/pipeline/ src/utils/recordingGateTable.ts src/content/visit*.ts --include='*.ts' | grep -v __tests__ | head -20
```

### 落とし穴

- 判定順序・結果を変えない（既存テストが緑のまま移設されること）
- content側のadapter境界を保つ（contentに判定核を持ち込まない）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過 + tableテスト新規通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
