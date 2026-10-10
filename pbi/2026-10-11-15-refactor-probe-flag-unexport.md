# PBI: E2E_PROBE_COMPILED_IN の export をやめる

- 種別: refactor
- RICE: 2.0（R2 × I0.25 × C1.0 / E0.25）
- 依存: なし（NN14 と同ファイル別行のため実装は NN14 の後に直列。W3 単独）
- バッチ: review-followup
- 台帳: `pbi/2026-10-11-00-backlog-review-followup.md`
- 出所: code-review レビュー指摘 #5（2026-10-11）

## ユーザーストーリー

保守担当者として、モジュールの公開面を最小に保ちたい。なぜなら `E2E_PROBE_COMPILED_IN` はモジュール内部でしか使われていないのに export されており、将来「外部から参照してよい定数」と誤読されるから。

## 優先度

- 順位: 5 / 5
- RICEスコア: 2.0（Reach=2 / Impact=0.25 / Confidence=1.0 / Effort=0.25）
- 根拠: 効果は公開面の微縮小（Impact 0.25）だが、修正は1行で確定（C 1.0）。

## 背景（現状・証拠）

- `src/content/e2eTestState.ts:24` — `export const E2E_PROBE_COMPILED_IN`。利用箇所は同ファイル内の `isE2EProbeEnabled`（line 64）・`publishE2eTestState`（line 82）のみ。テストからの参照はない。
- 注意: NN14 が本定数を `contentKernel.ts` から import する形で実装された場合、本 PBI の前提（内部利用のみ）が崩れる。その場合は本 PBI を取り下げ、NN14 の実装に吸収された旨を台帳に記録して閉じる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 外部参照がない
  Given 全コードベースを grep する
  When E2E_PROBE_COMPILED_IN の参照を探す
  Then e2eTestState.ts の定義＋内部2箇所のみに一致する

Scenario: 非 export 化しても壊れない
  Given export を外す
  When 型検査・lint・テストを実行する
  Then すべて green のまま
```

## 受け入れ基準

- [ ] 外部参照ゼロを grep で確認する（NN14 実装後の状態で再確認すること）
- [ ] `export` を外し、`npm run type-check`・`npm run lint`・対象テストが green
- [ ] `npm run validate` が green

## テスト戦略

- grep 検証＋既存ゲート（新規テスト不要の1行変更）。
- 回帰: `e2eTestState.test.ts` が green のまま。

## 見積もり

0.25 SP（1行変更＋grep＋ゲート確認。NN14 との相互作用確認を含む）

## 技術的考慮事項

- NN14 との相互作用が本 PBI の唯一のリスク。NN14 着地後に grep を再実行し、参照が増えていたら取り下げて閉じる（作業は NN14 側に吸収）。
- `isolatedModules` 互換（`export {}` 等）に影響しないことを確認する。

## 実装者向け注記

### 実装手順

1. NN14 の着地を確認し、grep で外部参照ゼロを再確認する
2. 参照ゼロなら export を外す／参照ありなら取り下げて台帳に記録する
3. `npm run validate`

### 落とし穴

- 取り下げ判断を先延ばしにしない（NN14 着地直後に確定させる）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `npm run validate` が green
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
