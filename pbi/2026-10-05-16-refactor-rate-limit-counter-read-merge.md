# PBI: `RateLimitService` の「両 store 読み込み + 保留マージ」が 2 重

## ユーザーストーリー

レート制限の保守担当者として、読み取り側と更新側のカウンタ取得を 1 つにしたい。同一ファイル内に約 30 行の同一シーケンスが 2 箇所あり、キー配列が別々に evolution しうるから。

## 優先度

- 順位: 17/32
- RICE: 4.0（R4 / I1 / C1.0 / E1）
- 根拠: レート制限のセキュリティ条件が読み取り側と更新側でずれうる構造
- 依存: なし

## 背景（file:line 現状）

すべて `src/utils/RateLimitService.ts`:

- `:89-118`（`checkRateLimit` の「session/local 両 store の読み取り → `attempts` の max 取り → `firstAttempt` の min フィルタ → `pendingCounters` マージ」）
- `:158-181`（`recordFailedAttempt` が同一シーケンスを再実装）
- 共通部分はキー配列リテラル（`:89-93` / `:158-161`）、`Math.max`（`:104-107` / `:168-170`）、`firstAttemptCandidates` 生成 + `Math.min`（`:109-118` / `:171-181`）
- 差分は `LOCKED_UNTIL` を読むかのみ
- 影響: 新しいカウンタキーを片方にだけ足す等の片寄り evolution が起きると、レート制限の判定条件が読み取り側と更新側でずれる

## BDD受け入れシナリオ

```gherkin
Scenario: 読み取りと記録で同一の取得ロジックが使われる
  Given 新しいカウンタキーが追加される
  When checkRateLimit と recordFailedAttempt が動作する
  Then 両者が同一の readCounters を経由し、キー集合のずれが起きない

Scenario: ロック判定の挙動が変わらない
  Given ロック中・ロックアウト付与の既存入力
  When 実行する
  Then early-return（:128-134 のロック判定、:136-152 のロックアウト付与）と coalesce タイマー処理（:46-86）の位置も条件も不変である
```

## 受け入れ基準

- [x] `private async readCounters(extraKeys: readonly string[] = [])` と `private mergeCounters(...)` が抽出されている
- [x] `checkRateLimit` が `readCounters([LOCKED_UNTIL])` を呼ぶ形になっている
- [x] 既存の early-return と coalesce タイマー処理は位置も条件も不変
- [x] 書き込み側 `flushPendingWrites` はそのまま
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存のレート制限テストが green。抽出後の分岐カバレッジが落ちないこと
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/utils/RateLimitService.ts`（readCounters / mergeCounters の抽出。`recordFailedAttempt` は `readCounters()` + `mergeCounters(..., now())`）
- ゲート: 対象 14 tests green / type-check PASS / lint 0 errors
