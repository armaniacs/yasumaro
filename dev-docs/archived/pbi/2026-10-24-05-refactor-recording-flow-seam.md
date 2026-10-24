# PBI: 記録フロー順序の単一seam化

## ユーザーストーリー

保守担当者として、intake〜保存tailの順序を単一seamに寄せたい。なぜなら1記録の理解に3 module往復が必要で、呼び側が順序知識を持つから。

## 優先度

- 順位: 05 / 全8件
- RICE スコア: 5.8（Reach = 6 / Impact = 3 / Confidence = 0.8 / Effort = 2.5人日）
- 根拠: NN04 の後に実施（同orchestratorに触れるため）。順序変更・sink追加コストの集中。

## ビジネス価値

呼び側は record/preview のみ学べばよくなり、順序変更・sink追加が1箇所になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 記録が単一seamで流れる
  Given 閲覧記録がある
  When 記録する
  Then 変更前と同一に保存される

Scenario: sink追加が1箇所で済む
  Given 新しい保存先がある
  When 追加する
  Then 順序所有の1箇所だけ変えれば済む
```

## 受け入れ基準

- [x] 順序所有が単一seamに寄り、呼び側が順序知識を持たない
- [x] visitPayloadがwire梱包adapterに留まる
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 記録フロー全体のテスト維持

### 単体テスト
- 順序・sink fan-outのテスト

## 実装アプローチ

- **Outside-In**: 順序の失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

2.5pt（🟡中）

## 技術的考慮事項

- 依存関係: NN04 の後に実施（同orchestrator）
- 非機能要件: 保存結果・順序不変

## 変更点の概要

順序所有を RecordingOrchestrator + SavePhase の単一seamに寄せる。

## 現状と問題（file:line 付き）

- `src/content/visitReporter.ts:200` ― VALID_VISIT送信・梱包
- `src/content/getContentHandler.ts:65` ― GET_CONTENTのextract呼出し
- `src/content/visitPayload.ts:35,75` ― wire契約の所有者
- `src/background/pipeline/RecordingOrchestrator.ts:107-118` ― preSaveSteps＋savePhase委譲
- `src/background/pipeline/savePhase.ts:41` ― SAVE_SINK_ORDER 4 sink fan-out
- `src/offscreen/sqliteEngine.ts:1-21`・`sqliteBoot.ts:34-57` ― 生成seam

## 変更の理由（depth・locality）

3 module往復の知識分散。単一seamで解く。

## 提案コード（骨子のみ）

```typescript
// intake〜保存tailの順序を所有する単一seam。
// 呼び側は record/preview のみ。visitPayloadは梱包adapter。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "preSaveSteps\|SAVE_SINK_ORDER" src/background/pipeline/RecordingOrchestrator.ts src/background/pipeline/savePhase.ts | head
```

### 落とし穴

- 保存順序・結果を変えない
- NN04 と同ファイルを触るため必ず後に実施する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
