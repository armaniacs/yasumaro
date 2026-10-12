# PBI: RecordingPipeline の Obsidian 要約書き込み skip を再活性化する

- 種別: test
- RICE: 8.0（R2 × I1 × C1.0 / E0.25）
- 依存: なし（NN02 / NN03 とファイル非重複）
- 出所: autonomous-task-closer が残課題として報告した skipped test 4 箇所（2026-10-12）を pbi-backlog-prioritizer で PBI 化
- 台帳: `pbi/2026-10-12-00-backlog-skipped-test-cleanup.md`

## ユーザーストーリー

保守担当の開発者として、生成した AI 要約が Obsidian へ実際に書き出されることをパイプライン harness 上で検証したい。なぜなら当該テストは skip されたままで、`saveToObsidianStep` への要約受け渡しが壊れても緑のまま通り、利用者には「要約が保存されない」という無言の故障として現れるから。

## 優先度

- 順位: 1 / 3
- RICEスコア: 8.0（Reach=2 / Impact=1.0 / Confidence=1.0 / Effort=0.25）
- 根拠: 3 候補中唯一「カバレッジを増やす」候補。真因が実測で特定済みで修正は数行、確実性が高い。削除系 2 候補（NN02/NN03）より Impact が大きい。

## 背景（現状・証拠）

- `src/background/pipeline/__tests__/RecordingPipeline.test.ts:419` — `it.skip('saves the AI summary to Obsidian')`。
- skip 理由コメント（415-417 行）は「RecordingPipeline が obsidian を context 経由で `saveToObsidianStep` に渡さないため `MockedObsidianClient` が呼ばれない。テスト設計の問題」と主張する。
- しかし**同じ harness の active テストが obsidian 経路に到達できている**: 同ファイル 467 行 `it('returns success while registering obsidian-write-failed as pending when only saveObsidian fails')` は `failingObsidian` オブジェクトを `makeOrchestrator` へ直接注入し、`appendToDailyNote` の reject を観測している。よって skip コメントの前提は stale。
- 真因: skip テストは `MockedObsidianClient.mockImplementation(...)`（138 行でモック化した `ObsidianClient` クラス）で `mockAppend` を仕込むが、`makeOrchestrator` に渡しているのは `makeObsidian()`（159-163 行が返す**ただのリテラル** `{ appendToDailyNote: vi.fn() }`）である。クラスモックは使われないため `mockAppend` は呼ばれない。
- 同等の検証は別 harness の `src/background/__tests__/recordingPipeline-impl.test.ts:564`（`it('saves the AI summary to Obsidian')`）にもあるが、`RecordingPipeline.test.ts` の harness 固有の配線（`makeOrchestrator` 経由）では pin されていない。

## BDD 受け入れシナリオ

```gherkin
Scenario: 生成した要約が Obsidian へ書き出される
  Given プライバシーパイプラインが要約 "Generated AI summary" を返す
  And 記録可能な URL と設定がある
  When  RecordingPipeline.record() を実行する
  Then  結果は success になる
  And  注入した appendToDailyNote が 1 回呼ばれる
  And  その第1引数に "Generated AI summary" が含まれる

Scenario: 要約が空でも書き込み経路が維持される
  Given プライバシーパイプラインが空の要約を返す
  When  RecordingPipeline.record() を実行する
  Then  結果は success になり、appendToDailyNote の呼び出し有無が現行実装どおりに観測できる
  And  テストは skip されておらず実行されている
```

## 受け入れ基準

- [x] `RecordingPipeline.test.ts:419` の `it.skip` が `it` になり、テストが実行されて green になる
- [x] obsidian クライアントは `MockedObsidianClient.mockImplementation` ではなく、`makeOrchestrator` の第2引数へ `{ appendToDailyNote: mockAppend }` を注入する形で渡している（467 行の active テストと同じ配線）
- [x] stale な skip 理由コメント（「context 経由で渡らない」旨）を削除または実態に合わせて更新している
- [x] 当該テストが red になりうることを確認している（例: `makeOrchestrator` へ渡す obsidian を `vi.fn()` のみにして失敗させ、戻して green。記録を残す）
- [x] `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts --repeats=20` が安定して green
- [x] `npm run validate` が green

## テスト戦略

- unit（修正）: 既存 skip テストの再活性化。新規ファイルは作らない。
- Red 確認: obsidian 注入を外して失敗することを1回実測し、テストが「常に green の飾り」でないことを示す。
- 回帰: 同ファイルの active テスト（467 行の obsidian-write-failed 系を含む）が green のまま。

## 見積もり

0.25 SP（注入の書き換え＋skip 解除＋Red 確認）

## 技術的考慮事項

- `MockedObsidianClient` はファイル冒頭で `ObsidianClient as MockedClass<typeof ObsidianClient>` として定義され、他テスト（212 行など）でも使われている。**クラスモック自体は残してよい**が、本テストでは `makeOrchestrator` に渡す値が参照される。どちらの流儀が harness の正なのかを 467 行の先行例に合わせて統一する。
- `MockedObsidianClient.mockImplementation` を本テストから外すと、`vi.clearAllMocks()`（beforeEach 169 行）との相互作用で他テストへ影響しないことを確認する。
- `--repeats=20` は AGENTS.md の「タイミング失敗を固定待ちで隠さない」規約に沿った安定性確認であり、実時間待ちを追加しない。

## 実装者向け注記

### 実装手順

1. 419 行の skip テストを `it` へ戻す。
2. `MockedObsidianClient.mockImplementation(...)` を削除し、`const mockAppend = vi.fn(...)` を `{ appendToDailyNote: mockAppend }` として `makeOrchestrator` の第2引数へ渡す。
3. Red 確認（obsidian を空 `vi.fn()` にして失敗させる）→ 戻して green。
4. `npx vitest run <file> --repeats=20` と `npm run validate`。

### 落とし穴

- `vi.clearAllMocks()` により `makeObsidian()` の `vi.fn()` はテストごとにクリアされる。assertion 対象の fn はテスト内でローカルに生成する。
- 実時間待ちを入れない（`RecordingPipeline` は注入済み sleep を使う設計）。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る（`npm run validate` green）
- [x] 検証結果（コマンドと結果）を PBI に記録する
- [x] コードレビュー完了

## 検証結果（2026-10-12 実施）

- Red 確認: 注入を一時的に `{ appendToDailyNote: vi.fn() }`（実装なし）へ変更 → 対象のみ失敗（`AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times`、他 22 テストは green）→ 元に戻して green。テストが「常に green の飾り」でないことを実証。
- `npx vitest run src/background/pipeline/__tests__/RecordingPipeline.test.ts --repeats=20` → Test Files 1 passed / Tests 23 passed（23 × 20 = 460 実行、全 green）。
- 実時間待ちは未追加（`RecordingPipeline` は注入済み sleep を使う設計）。
- 変更ファイル: `src/background/pipeline/__tests__/RecordingPipeline.test.ts` のみ（420 行で `it` 化、429 行で第2引数注入形、440 行で `toHaveBeenCalledTimes(1)` に強化、BDD シナリオ2 を新規テスト 1 件として自動化）。
- コードレビュー: マージ時にメインエージェントが全差分をレビュー済み。
