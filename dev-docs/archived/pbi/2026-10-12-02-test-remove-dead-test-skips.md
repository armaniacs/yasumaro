# PBI: 死んだ無条件 skip スタブ 9 件と空 describe 1 件を削除する

- 種別: test
- RICE: 4.0（R2 × I0.5 × C1.0 / E0.25）
- 依存: なし（NN01 / NN03 とファイル非重複）
- 出所: autonomous-task-closer が残課題として報告した skipped test 4 箇所（2026-10-12）を pbi-backlog-prioritizer で PBI 化
- 台帳: `pbi/2026-10-12-00-backlog-skipped-test-cleanup.md`

## ユーザーストーリー

保守担当の開発者として、本体が空で廃止済み契約だけを名前として残している skip スタブを削除したい。なぜなら「skip 済みテストが N 件ある」というノイズが、どのカバレッジが本当に無防備なのかを読み取れなくし、`--repeats` やスイート監視のシグナルも薄めるから。

## 優先度

- 順位: 2 / 3
- RICEスコア: 4.0（Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.25）
- 根拠: 影響は保守性のみ（Impact 小）だが、真因と代替カバレッジが実測済みで確実性が高く、工数最小。NN03（lint ゲート）の前提になる。

## 背景（現状・証拠）

対象は **9 件の `it.skip` と 1 件の空 `describe.skip`**（2026-10-12 実測）。

| ファイル:行 | skip 名 | 本体 | 陳腐化の理由 |
|---|---|---|---|
| `src/background/__tests__/robustness-data-integrity.test.ts:184` | saves the URL only when the Obsidian write succeeds | 空（コメントのみ） | 旧契約。現行は BEST_EFFORT + offlineRetry |
| 同 `:189` | does not save the URL on network errors | 空 | 同上 |
| 同 `:193` | does not save the URL on API errors | 空 | 同上 |
| 同 `:197` | does not save the URL on timeout | 空 | 同上 |
| 同 `:203` | `describe.skip('エッジケース: 書き込み失敗時のURL整合性')` | 空ブロック | 同上 |
| 同 `:230` | calls setSavedUrlsWithTimestamps only for new URLs | 空 | 重複判定は実装済み |
| 同 `:257` | saves URLs correctly for parallel calls | 空 | 並行直列化は別テストで pin 済み |
| 同 `:261` | keeps consistency when some parallel requests fail | 空 | 同上 |
| `src/background/__tests__/recordingPipeline-full.test.ts:283` | waits for the same-URL mutex before writing to Obsidian | コメントのみ | PBI-02 で static mutex 撤去。PerUrlMutexMap の DI 化済み |
| `src/background/__tests__/recordingCache-settingsCache.test.ts:193` | refetches when the cache version changes | `() => {}` | 2 重キャッシュ簡素化でバージョンチェック自体が消滅 |

由来: `robustness-data-integrity.test.ts` は 2026-03-26 `78daddf3`「未実装機能のテストをスキップ」、`RecordingPipeline.test.ts` は 2026-04-17 `5a1699b9`（Jest→Vitest 移行）、`recordingPipeline-full.test.ts` は 2026-09-01 `a3101b49`（Architecture Deepening 0831a PBI-01）、`recordingCache-settingsCache.test.ts` は 2026-09-11 `79db6ad1`（TEST_RULE 準拠ラウンド）。

### 削除前に確認する現行カバレッジの対応

| 削除する期待 | 現行の pin 先（active） |
|---|---|
| 書き込み失敗時に URL を保存しない | `robustness-data-integrity.test.ts:167`（best-effort）／同 `:236`（force=true 変種） |
| 書き込み失敗が pending に登録される | `RecordingPipeline.test.ts:467,502`／`recordingOutcome.test.ts:179` |
| 重複 URL では保存をスキップ | `robustness-data-integrity.test.ts:208` |
| 並行 record() の直列化・整合性 | `recordingPipeline-full.test.ts` の active「同一URLへの並行 record() の直列化」 |
| 設定キャッシュの再取得 | `recordingCache-settingsCache.test.ts` の TTL ベース active テスト群 |

上表のとおり全期待に pin 先がある。**もし削除対象の期待のうち pin 先が確認できないものがあれば、削除ではなく現行契約の active テストとして書き直す**（削除が目的化しないこと）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 空の skip スタブが消えている
  Given 上記 4 ファイルがある
  When  無条件の it.skip / describe.skip を検索する
  Then  src/background 配下のユニットテストでは 0 件になる
  And  スイート全体の skipped 件数が 10 件減る

Scenario: 削除しても契約が無防備になっていない
  Given 削除する各期待に対して現行の pin 先が対応表に記録されている
  When  ユニットスイートを実行する
  Then  対応表の pin 先テストがすべて実行され green になる
```

## 受け入れ基準

- [x] 上記 9 件の `it.skip` と 1 件の空 `describe.skip` が削除されている（または pin 先が無い期待のみ active テストとして復元されている）
- [x] 削除前に「期待 → 現行の pin 先」の対応表を作り、pin 先が実在し green であることを実測している（対応表は PBI に記録）
- [x] 空になった `describe.skip` ブロックの跡に、削除理由を英語コメントで残していない（削除は削除として完結させる。理由は PBI 側に残す）
- [x] 対象 3 ファイルのテストが green（`npx vitest run src/background/__tests__/robustness-data-integrity.test.ts src/background/__tests__/recordingPipeline-full.test.ts src/background/__tests__/recordingCache-settingsCache.test.ts`）
- [x] スイート全体の skipped 件数が 21 → 11（`manifest.test.ts` の dist 依存 11 件を除き 0）になる
- [x] `npm run validate` が green

## テスト戦略

- unit（削除）: 実行されていないテストの削除であり、新規の挙動テストは追加しない（pin 先が無い場合のみ追加）。
- 検証: 削除前後でスイート全体の `passed` 件数が減っても、`failed` 0 を維持する。`skipped` 件数の変化を実測で記録する。
- 回帰: 対応表の pin 先テストがすべて green。

## 見積もり

0.25 SP（対応表の実測＋削除＋スイート再実行）

## 技術的考慮事項

- `robustness-data-integrity.test.ts` の `describe.skip('エッジケース: 書き込み失敗時のURL整合性')` は**本体がコメントのみの空ブロック**なので、ブロックごと削除する。
- 削除対象ファイルに `isPrivateIpAddress` 等の未使用 import が残らないよう `npm run lint` で確認する（no-unused-vars は error）。
- `manifest.test.ts` の 11 件は `dist/` の有無による `describe.skip`（条件付き）であり**本 PBI の対象外**。誤って消さないこと。
- E2E（`testDir/`）の 8 件の `test.skip` は `test.skip(cond, reason)` の実行時条件付きで正当。本 PBI の対象外。

## 実装者向け注記

### 実装手順

1. 対応表の pin 先テストを個別に実行し、実在と green を確認する。
2. 9 件の `it.skip` と空 `describe.skip` を削除する。
3. 対象 3 ファイルを実行し green を確認する。
4. スイート全体の skipped 件数を実測（`npx vitest run --reporter=json` 等）し、21 → 11 を確認する。
5. `npm run validate`。

### 落とし穴

- 実行されていないテストを消すこと自体は安全だが、**削除対象の名前が示す期待が現行契約でも生きている**場合は削除ではなく書き直しになる。対応表の確認を省略しない。
- `vi.clearAllMocks()` や `beforeEach` のセットアップが削除対象だけを対象にしていた場合、未使用変数が残って lint が落ちる。削除後に lint を回す。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る（`npm run validate` green）
- [x] 検証結果（コマンドと結果・skipped 件数の変化）を PBI に記録する
- [x] コードレビュー完了

## 検証結果（2026-10-12 実施）

削除前の pin 先実測（pin 先確認できない期待は 0 件 → 全 10 件削除、active への書き直し不要）:

| 削除する期待 | pin 先（active・実在と green を実測） |
|---|---|
| 書き込み失敗時に URL を保存しない | `robustness-data-integrity.test.ts:167`（best-effort）・`:236`（force=true 変種） |
| 書き込み失敗が pending に登録される | `pipeline/__tests__/RecordingPipeline.test.ts:467,502`・`recordingOutcome.test.ts:179` |
| 重複 URL では保存をスキップ | `robustness-data-integrity.test.ts:208` |
| 並行 record() の直列化・整合性 | `recordingPipeline-full.test.ts`「同一URLへの並行 record() の直列化」active 2 件 |
| 設定キャッシュの再取得 | `recordingCache-settingsCache.test.ts` の TTL ベース active テスト群 |

- 削除後: 対象 3 ファイル + `recordingOutcome.test.ts`（実パスは `src/background/pipeline/__tests__/`）で 69 passed / skipped 0 / failed 0。対象 3 ファイルで 53 passed / skipped 0。
- `npx eslint <対象3ファイル>` 削除前後とも exit 0（未使用 import/変数なし）。削除跡に SKIPPED コメント 0 件（grep 確認）。
- スイート全体の skipped: 21 → 0（NN03 の manifest 11 件解消と合わせて。最終フルスイートで skipped 0 を確認）。
- コードレビュー: マージ時にメインエージェントが全差分をレビュー済み。
