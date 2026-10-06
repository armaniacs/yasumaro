# PBI: chrome.alarms の作成者が alarmRegistry の統一テーブル外にあり、daily スケジュールが毎録画でリセットされる

## ユーザーストーリー

ローカル Markdown 書き出しの利用者として、daily フラッシュのアラーム所有を 1 箇所にしたい。録画のたびにアラームが作り直され、真夜中フックが実質成立しないから。

## 優先度

- 順位: 11/32
- RICE: 4.0（R5 / I2 / C0.8 / E2）
- 根拠: 「全ての timed job は alarmRegistry に統一」との宣言に対し、作成が 4 箇所に分岐している
- 依存: なし

## 背景（file:line 現状）

- `src/background/alarmRegistry.ts` の `createJobs`（:123-151）に `yasumaro-local-md-flush` / `yasumaro-local-md-immediate` / `yasumaro-local-md-daily-flush` の **dispatch 行**はあるが、`installAll()`（:164-177）が作成するのは `staticSchedule` 付き行のみ
- 表外の作成者: `src/background/localMarkdownIdleFlusher.ts:74`（IDLE_FALLBACK）、`:79-82`（DAILY_FLUSH、`when: getNextMidnightTimestamp()` + `periodInMinutes: 1440`）、`:97-99`（IMMEDIATE、one-shot）
- 問題の 1 箇所: `src/background/pipeline/buffers/MarkdownBufferManager.ts:74-78` の `scheduleDailyFlush(alarmName?)` が `periodInMinutes: 1440` かつ **`when` なし**で作成。`:16` の `DEFAULT_DAILY_FLUSH_ALARM = DAILY_FLUSH_ALARM` で、`DAILY_FLUSH_ALARM` は `src/background/localMarkdownIdleFlusher.ts:18` の `'yasumaro-local-md-daily-flush'`（同一キー）
- 呼び出し: `src/background/pipeline/steps/saveLocalMarkdownStep.ts:97-103` で `timing === 'immediate'` 以外は**毎回** `markdownBuffer.scheduleDailyFlush()`（`:100` は `scheduleImmediateFlush()`）
- 所有宣言の矛盾: `localMarkdownIdleFlusher.ts:39-41` は DAILY_FLUSH_ALARM を当モジュールが所有と記載
- 影響: 真夜中 `when` で arm されたアラームが録画のたびに「作成から 24 時間後」へ作り直され、daily タイミングの真夜中フックが実質成立しない。idle 設定時は `initExportScheduler` が clear した直後に次の録画で同名が復活する（所有者不明）。`MarkdownBufferManager` は録画ごとに new される一時オブジェクトで、グローバルなアラームをインスタンスメソッドが持つのも不自然

## BDD受け入れシナリオ

```gherkin
Scenario: 録画しても daily アラームが作り直されない
  Given DAILY_FLUSH_ALARM が真夜中 when で arm されている
  When 録画が発生する
  Then アラームの when が変わらず、録画側は作成も再作成もしない

Scenario: 未 arm の場合だけ武装する
  Given DAILY_FLUSH_ALARM が存在しない
  When 録画が発生する
  Then 1 回だけ武装され、2 回目以降の録画では作り直されない

Scenario: immediate / idle-fallback の所有が table に寄る
  Given scheduleImmediateFlush と IDLE_FALLBACK の作成
  When installAll が走る
  Then install フック経由で作成され、録画側の直作成が残らない
```

## 受け入れ基準

- [x] daily アラームの唯一の作成者が `initExportScheduler` に固定され、録画側は「既に arm されていなければ武装」だけにする（または作成しない）
- [x] `scheduleImmediateFlush`（one-shot）と `IDLE_FALLBACK` が table 行として install フックに移っている
- [x] 既存の dispatch（`alarmRegistry.ts:62-71` の runLocalMdFlush / runLocalMdDailyFlush）は維持され、挙動不変
- [x] 既存の try/catch と null ガードはそのまま残る
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: `chrome.alarms` のモックで「録画時に作成が呼ばれない」「未 arm 時に 1 回だけ呼ばれる」を pin
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/background/localMarkdownIdleFlusher.ts`（`ensureDailyFlushArmed()` 追加。initExportScheduler を唯一の作成者として明示）、`src/background/pipeline/buffers/MarkdownBufferManager.ts`（arm-only への委譲。未使用の alarmName 引数を削除）、`src/background/pipeline/steps/saveLocalMarkdownStep.ts`（await 化）、`src/background/alarmRegistry.ts`（3 行に install フック追加。immediate 行は one-shot のため no-op install で所有を明示）
- immediate one-shot は install 時に事前武装できない（録画ごとのデバウンス置換が仕様）ため per-recording 作成を維持
- ゲート: 対象 4 ファイル 54 tests green / type-check PASS / lint 0 errors
