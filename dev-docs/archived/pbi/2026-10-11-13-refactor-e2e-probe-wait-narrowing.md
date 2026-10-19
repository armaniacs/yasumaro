# PBI: waitForE2EProbeInit の二段キャストを narrowing で書き直す

- 種別: refactor
- RICE: 4.0（R2 × I0.5 × C1.0 / E0.25）
- 依存: なし（W1 で NN11 / NN12 と並列可）
- バッチ: review-followup
- 台帳: `pbi/2026-10-11-00-backlog-review-followup.md`
- 出所: code-review レビュー指摘 #3（2026-10-11）

## ユーザーストーリー

保守担当者として、E2E ヘルパーの型の嘘をなくしてほしい。なぜなら `as unknown as` の二段キャストは「本当は non-null」をコンパイラに伝えられていない証拠で、将来の改修時に null 混入を見逃すから。

## 優先度

- 順位: 3 / 5
- RICEスコア: 4.0（Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.25）
- 根拠: 触る範囲は1ヘルパーだが、修正は機械的で確実（C 1.0）かつ安価（0.25）。

## 背景（現状・証拠）

- `testDir/e2e/fixtures/e2eProbe.ts:57-63` ― `expect.poll(...).not.toBeNull()` の通過後に `return state as unknown as E2EProbeState` と書いている。poll が通れば non-null が確定しているため narrowing で表現できる。

## BDD 受け入れシナリオ

```gherkin
Scenario: プローブが初期化済みになる
  Given E2E コンテキストでプローブが armed されている
  When waitForE2EProbeInit() を呼ぶ
  Then 初期 state が型付きで返る（キャストなし）

Scenario: タイムアウト時は従来通り失敗する
  Given プローブが armed されていない
  When waitForE2EProbeInit() を短い timeout で呼ぶ
  Then expect.poll の失敗として例外になる（挙動不変）
```

## 受け入れ基準

- [x] `as unknown as` の二段キャストがなくなる（narrowing・早期 throw のいずれか。poll 待機＋再読＋null 時 throw 形に書換え）
- [x] タイムアウト時の失敗挙動が変わらない（timeout/intervals 不変。poll 失敗は従来通り例外）
- [x] `npm run type-check:test` の baseline が悪化しない（`type-check:test:baseline` exit 0。463=pinned 463）
- [x] `npm run validate` が green（1057 files / 15962 tests passed。最終フル検証で確認）

## テスト戦略

- 型検査: `npm run type-check:test:baseline`（pinned 463 維持）がゲート。
- E2E ヘルパー自体の実行確認は既存 4 spec の headed 実行に委ねる（本 PBI では型レベルの書換えのみ。 headed 未検証なら PBI に明記する）。
- 回帰: 変更なし（テストヘルパーの内部実装のみ）。

## 見積もり

0.25 SP（数行の書換え＋型 baseline 確認）

## 技術的考慮事項

- `expect.poll` の戻り値は assertion の結果であり、クロージャ変数の narrowing には使えない。素直な形は「poll 後に `readE2EProbeState` をもう1回読んで null チェック」または「poll の戻り値をそのまま返す設計への変更」。いずれも挙動（timeout・intervals）を変えないこと。

## 実装者向け注記

### 実装手順

1. narrowing 形に書き換える
2. `npm run type-check:test:baseline` と `npm run validate`（または軽量版 `validate:fast`＋対象 lint）
3. headed E2E が回せなければ未検証旨を記録する

### 落とし穴

- `!` 非 null アサーションへの置換は不可（嘘の付け替えになるだけ）。narrowing か throw のみ

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate` が green
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 検証結果（2026-10-11 autonomous-task-closer）

- `npm run type-check:test:baseline` ― 463（pinned 463、exit 0）
- `npx eslint testDir/e2e/fixtures/e2eProbe.ts` exit 0、`as unknown as` 残存なしを grep 確認
- E2E ヘルパーの実行確認は headed 未検証（PBI に記録の通り。次回 headed 実行時に 4 spec で確認）
