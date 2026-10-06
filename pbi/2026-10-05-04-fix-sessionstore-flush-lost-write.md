# PBI: SessionStore の flush 連動で `flushImmediately` 書き込みが失われる

## ユーザーストーリー

SW の永続化に依存する機能開発者として、`set(flushImmediately:true)` の契約を本物にしたい。既に flush 実行中の場合は完了を待って何も書かずに返り、レート制限カウンタが SW 再起動で実質リセットされるから。

## 優先度

- 順位: 4/32
- RICE: 9.0（R6 / I3 / C1.0 / E2）
- 根拠: `set` の doc コメントが約束する持続性が、in-flight 中は果たされない。finally の再スケジュール条件を実測で確認済み
- 依存: なし

## 背景（file:line 現状）

- `src/background/sessionStore.ts:109-118` の `set()`: `flushImmediately` 指定時は `await this.flushNow()`
- 同 `:129-138` の `flushNow()`: timer を消してトークンを進め `await this.flush()`
- 同 `:175-180` の `flush()` 冒頭: `if (this.flushPromise) { await this.flushPromise; this.removeFromFlushQueue(promise); resolve(); return; }` → **in-flight flush の完了を待つだけで何も書かずに return**
- 同 `:281-288` の finally: 再スケジュールは `if (shouldRetry)` のみ。flush 期間中に writeQueue / deleteQueue に入ったキーは次回 `set` まで永続化されない
- 呼び出し側: `src/background/rateLimiter.ts:126-134` が `flushImmediately: true` を「持続性の根拠」とコメントで明記。`src/background/recordingCache.ts:296` も利用
- 弱い既存テスト: `src/background/__tests__/sessionStore.test.ts:497-510`「handles concurrent flush() calls by awaiting the in-flight flush」は `expect(mockSession.set).toHaveBeenCalled()` のみで、2 本目で追加された `key2` が実際に書かれたかを見ていない

## BDD受け入れシナリオ

```gherkin
Scenario: flush 中の set が失われない
  Given 1 本目の flush が in-flight の状態
  When key2 を set(flushImmediately:true) する
  Then 2 本目の flush 完了後に key2 が chrome.storage.session に書かれている

Scenario: 失敗時のリトライ契約は維持される
  Given flush が quota エラー以外で失敗する
  When shouldRetry が立つ
  Then 従来どおり再スケジュールされ、キューに戻された項目が再送される

Scenario: quota 超過時は従来どおり再試行しない
  Given session storage の quota を超過している
  When flush が失敗する
  Then メモリに保持したまま再試行せず、警告ログが出る
```

## 受け入れ基準

- [x] `flush()` の finally で「flush 期間中に writeQueue / deleteQueue が溜まっていたら必ず再スケジュール」する（`shouldRetry || writeQueue.size > 0 || deleteQueue.size > 0`）
- [x] `flushNow()` が in-flight の場合も「次ラウンドまで待って 1 回は書く」か、少なくとも契約違反を可視化できる（戻り値・ログのいずれか）
- [x] 既存テスト `sessionStore.test.ts:497-510` が「2 本目 flush 後に key2 が `mockSession.set` に含まれる」の assert へ変更されている
- [x] 既存の try/catch（quota / 一般リトライ）と `extractPriorityData` ガードはそのまま残る
- [x] 実時間待ちを使わないテストで検証する
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: `mockSession.set` を手動解決させ、in-flight 中の `set('key2')` → 両 flush 完了後に key2 が書き込み引数に含まれることを pin
- 単体: quota 超過・一般失敗の既存ケースが green のまま
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/background/sessionStore.ts`（in-flight 分岐でキュー残存時に次ラウンドを await して書き込み、finally の再スケジュール条件を拡張。quota 時は再試行しないガード付き）、`src/background/__tests__/sessionStore.test.ts`（並行 flush テストを deferred + key2 書き込み assert に強化）
- ゲート: 対象 55 tests green / type-check PASS / lint 0 errors
