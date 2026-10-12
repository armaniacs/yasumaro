# PBI: RecordingPipeline テストの注入モックを実契約型へ寄せる

code-review（2026-10-13）の指摘7 から起票。

## ユーザーストーリー

テストを保守する開発者として、`makeOrchestrator` へ注入するモックが実際の契約（`ObsidianClient` の `appendToDailyNote`）に型で寄っていることがほしい、なぜなら `as any` は実契約のシグネチャ不一致を隠し、本物のクライアントが変わってもモックが追従しないから。

## 優先度

- 順位: 07 / 全候補数 7（最下位）
- RICEスコア: **1.6**（Reach=2 / Impact=0.25 / Confidence=0.8 / Effort=0.25）
- 根拠: スタイル改善で実害なし（Impact 0.25）。CLAUDE.local.md はテスト内 `any` 型使用を許容しており、隣接テストと同型の一貫性もあるため「任意」の扱い。Confidence 0.8 は `Pick<ObsidianClient, 'appendToDailyNote'>` 形が vi.fn の型と通るかを実装時確認が必要なため。同点の NN06（検証穴のリスク軽減）を Impact で下回るため最下位。

## 背景

- `src/background/pipeline/__tests__/RecordingPipeline.test.ts` の 429 行と 452 行（NN01 2026-10-12 で再活性化した obsidian 経路テストと空要約テスト）は `{ appendToDailyNote: mockAppend } as any` で注入している。
- `ObsidianClient.appendToDailyNote` は `src/background/obsidianClient.ts:238` に実在し、テストファイルは既に `ObsidianClient` を import している（133 行）。
- `as Pick<ObsidianClient, 'appendToDailyNote'>` 形（vi.fn のシグネチャが実契約と通る場合）に寄せると、実契約の変更が型で検出される。隣接テストも同パターンのため、統一する場合は一括。

## BDD受け入れシナリオ

Scenario: 型で契約に寄せる
  Given `{ appendToDailyNote: mockAppend }` の注入モック
  When  `as Pick<ObsidianClient, 'appendToDailyNote'>` 形に寄せる
  Then  `npm run type-check` が通る（vi.fn のシグネチャが実契約と一致する場合。一致しない場合はモック側を実シグネチャに寄せる）

Scenario: テストの動作は変わらない
  Given 型転換後のテスト
  When  `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts --repeats=20` が走る
  Then  従来どおり green

## 受け入れ基準

- [ ] obsidian 経路 2 テスト（再活性化テスト + 空要約テスト）の注入モックが `Pick<ObsidianClient, 'appendToDailyNote'>` 形（または unknown 経由の狭い型）に寄せられている
- [ ] vi.fn のシグネチャが実契約と一致しない場合、モック側を実シグネチャに寄せて型を通す（`as any` のまま残さない）。`any` を維持する判断をした場合は CLAUDE.local.md の許容を根拠に PBI に記録して閉じる
- [ ] `npm run type-check` が green
- [ ] `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts --repeats=20` が green
- [ ] `npm run validate` が green

## テスト戦略

- 単体: 既存テストの型転換のみ（動作は変えない）。`--repeats=20` で安定性を確認。E2E/統合は不要。

## 見積もり

0.25 SP

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] type-check / lint / test が通る（`npm run validate` green）
- [ ] 検証結果（コマンドと結果）を PBI に記録する
- [ ] コードレビュー完了
