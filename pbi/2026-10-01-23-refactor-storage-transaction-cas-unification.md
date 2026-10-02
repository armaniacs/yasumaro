# PBI: storageTransaction の CAS 再試行シェルと post-write verify の統一

優先度: 16 / RICE 6.5
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「ハンドラ足場のコピー群」）
依存: なし（他 PBI とファイル重複なし）

## ユーザーストーリー

設定やページキューなど単一キー書き込みを保守する開発者として、CAS トランザクションの再試行規律を 1 実装に集約してほしい、なぜなら「競合 → backoff → 再読み」のシェルと TOCTOU を塞ぐ post-write verify が `withLock` と `withAtomic` に二重実装されており、verify の意味を変更するときに片方だけ直すと単一キーと複数キーのトランザクションが乖離するから。

## 背景（現状）

- `src/utils/storage/storageTransaction.ts:147-172`（`withLock`）と `:185-233`（`withAtomic`）が同一の再試行シェルを重複保持している
  - `ConflictError` 捕捉時の `attempt++`
  - 上限超過時の `throw new ConflictError(..., -1, -1)`（`:165` と `:227`）
  - `backoffDelayMs(attempt - 1, { baseMs: initialDelay })` と `setTimeout`（`:166-167` と `:228-229`）
  - 再試行診断の `logDebug` が重複
- post-write verify が重複している: `withAtomic` の検証（`:207-216`）と `performCasUpdate` の検証（`:284-290`）が同じ version + `deepEqual` 判定と `ConflictError` 形状を持つ

## BDD シナリオ

```gherkin
Scenario: 競合時の再試行が単一実装で決まる
  Given 1 回目の write が ConflictError を返す
  When withLock と withAtomic の両方で再試行する
  Then 両者が同じ backoff 時刻列と同じ上限エラー形状を持つ

Scenario: 検証失敗時の報告が単一実装で決まる
  Given post-write の version か deepEqual が不一致
  When トランザクションをコミットする
  Then withLock と withAtomic が同じ ConflictError を投げる
```

## 実装宣言

- 挙動維持: backoff 時刻列・最大試行回数・エラー形状・ログ文言は不変
- 共有シェル（例: `runCasRetryLoop({ attempt, maxRetries, initialDelay, operation })`）へ再試行を移し、`withLock` と `withAtomic` は引数で差分（verify 有無、複数キーか単一キーか）を渡すだけにする
- post-write verify は 1 つの関数（例: `verifyPostWrite`）へ集約し、両経路から呼ぶ

## 受け入れ基準

- [x] 再試行シェル（attempt / backoff / 上限 / ログ）が 1 実装になる
- [x] post-write verify の version と deepEqual 判定が 1 実装になる
- [x] backoff 時刻列と ConflictError のメッセージが現状と不変
- [x] 既存テスト（`src/utils/storage/__tests__/`）が変更なしで green

## 実装記録（2026-10-02）

変更した内容（`src/utils/storage/storageTransaction.ts` のみ）:

- `runCasRetryLoop(runAttempt, shell)` を新設し、`withLock` と `withAtomic` の再試行規律（ConflictError の捕捉、attempt の加算、上限超過時の `ConflictError(conflictKey, -1, -1)`、`backoffDelayMs(attempt - 1, { baseMs: initialDelay })`、再試行 `logDebug`、非 ConflictError の再 throw）を 1 実装へ移動。差分は `CasRetryShell` の引数（label / conflictKey / maxRetries / initialDelay / sleep / retryLogData / fallbackMessage）だけで表す
- `retryLogData` をメソッドごとに呼べる形にした理由: 2 経路は試行回数のフィールド名が異なる（`attemptCount` / `attempt`）うえ payload 自体がログ契約の一部であり、1 つにまとめるとログ出力が変わる
- `verifyPostWrite(port, keys, expectedValues, expectedVersions)` を新設し、`withAtomic` の post-write 検証と `performCasUpdate` の検証を 1 実装へ移動
- `withLock` / `withAtomic` / `withOptimisticLock` / `withAtomicKeys` の options 型を `CasRetryOptions` に統一

追加したテスト（新規 `src/utils/storage/__tests__/storageTransaction-retry.test.ts`、wait は注入した recorder で記録し壁時計を待たない）:

- 競合が続き続けるポートで、`withLock` と `withAtomic` が同じ backoff 時刻列（`[25, 50, 100, 200]`）を要求し、両者が同じ列になることを assert
- 既定予算で 1 試行あたり 1 回 sleep し、合計 5 回で打ち切られることを assert
- 予算を使い切ったとき両者が `Conflict detected for key: k (expected: -1, actual: -1)` / `... for key: a+b (expected: -1, actual: -1)` という同一形のエラーを投げることを assert
- ConflictError 以外の失敗は sleep を挟まず即 rethrow されることを assert
- post-write verify で失われた単一キー書き込みが再試行され、競合者の値の上に commit されることを assert（write 直後に key を上書きする port で再現）
- 同様に post-write verify で失われた複数キー書き込みが再試行されることを assert
- 失われ続ける書き込みは両形状とも各形状の key 名を含む ConflictError で失敗することを assert
- verify を通過した書き込みは commit されることを assert

既存テストは 1 行も変更していない（受け入れ基準 4 の「変更なしで green」を満たす）。

**逸脱（記録のみ）**: 共有 options に public な `sleep?: SleepFn` を追加した。既定値は既存の `waitForRetry`（`src/utils/retryPredicate.ts`）で、production の挙動は完全に同一。追加 이유는 TEST_RULE の実時間待ち禁止で、新しい再試行テストが試行回数を数えるのに壁時計を待たないためには注入できる必要があるため。`src/utils/retryPredicate.ts` 自体は変更していない（export されている `waitForRetry` を import しただけ）。

検証: `npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。

## テスト戦略

- 既存の storageTransaction テストが変更なしで green（backoff は注入可能な sleep を使い、実時間待ちにしない）
- 共有シェルの単体テスト: 複数回競合した場合の再試行回数・sleep 呼び出し回数・最終エラーを 1 箇所に固定
- 検証: `npm run type-check` と `src/utils/storage/__tests__/` の vitest

## 実装内容

1. 再試行シェルの共通関数化（`withLock` と `withAtomic` から利用）
2. post-write verify の共通関数化
3. 既存テストの不変確認

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [x] コードレビュー完了（統合担当が実装内容と diff を照合して確認）
