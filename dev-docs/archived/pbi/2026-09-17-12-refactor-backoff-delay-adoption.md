# PBI: 指数バックオフ残存5箇所の backoffDelayMs 移行（refactor）

優先度: 順位 2 / 4（RICE: 8.0 = Reach 4 / Impact 1 / Confidence 1.0 / Effort 0.5 pt。全候補5件中3位・1位は台帳清掃）
backlog: [2026-09-17-00-backlog-arch-review-0917b.md](2026-09-17-00-backlog-arch-review-0917b.md)（台帳）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、残存する手書きの指数バックオフ計算5箇所を `backoffDelayMs` への委譲に置き換えてほしい、なぜなら同じ知識（`base * multiplier^attempt` を cap で頭打ちにする式）が複数ファイルに分散して書かれており、値を変えたいときに場所ごとの揺れを見落とす危険があるから。

## 背景（現状と課題）

`src/utils/backoff.ts` の `backoffDelayMs(attempt, opts)` が PBI 09（archived: 2026-09-17-09）で新設され、`messageTransport` / `dashboardGateway` / `fetchWithRetry` の遅延計算は移行済みである。一方、以下5箇所が `Math.pow(2, ...)` の手書き計算を残している（いずれも実在を確認済み）：

1. `src/background/pipeline/stepExecutor.ts` の `StepExecutor.executeWithStrategy()`（リトライ分岐内） — `1000ms * 2^retries` を 5000ms で cap。`retries` はインクリメント後の 1-origin 値である。
2. `src/utils/storage/storageTransaction.ts` の `StorageTransaction.withLock()`（`ConflictError` catch 内） — `initialDelay * 2^(attemptCount - 1)`。cap なし。
3. 同ファイルの `StorageTransaction.withAtomic()`（`ConflictError` catch 内） — `initialDelay * 2^(attempt - 1)`。cap なし。
4. `src/utils/trustDb/TrustDbKernel.ts` の `doInitializeWithRetry()`（リトライループ内） — `100ms * 2^attempt`（`attempt` は 0-origin）。cap なし。
5. `src/utils/trustDb/trancoUpdater.ts` の `TrancoUpdater.updateTrancoList()`（リトライループ内） — `baseDelay * 2^(attempt - 1)`（`attempt` は 1-origin、`baseDelay` は 1000ms）。cap なし。

対応方針は次の1点である：上記5箇所の遅延計算のみ `backoffDelayMs` に委譲する。再試行可否の判定の述語（`ConflictError` 判定、`ErrorStrategy.RETRY` 判定、`maxRetries` 到達判定等）は各ドメインに残す。jitter 等の拡張は本 PBI のスコープ外とする（導入するなら別 PBI で parity を pin してから）。

注意として、attempt インデックスの基準（0-origin / 1-origin）が各箇所で異なる。着手時に `backoffDelayMs` の引数契約（0-origin を想定）を確認し、オフセット差は呼び出し側で吸収すること（例: `attempt - 1` を渡す）。遅延値は現行と完全一致（byte-identical）とする。

## BDD受け入れシナリオ

```gherkin
Scenario: 5箇所のリトライ遅延が委譲後も現行値と同一（parity）
  Given StepExecutor・StorageTransaction（withLock / withAtomic）・TrustDbKernel・TrancoUpdater の5箇所のリトライ実装
  When 遅延計算を backoffDelayMs に委譲する
  Then 各 attempt の遅延値が委譲前と同一である
    # 例: stepExecutor 系は baseMs 1000・multiplier 2・maxMs 5000、
    # storageTransaction 系は baseMs initialDelay（デフォルト 100）・multiplier 2（cap なし）、
    # TrustDbKernel 系は baseMs 100・multiplier 2（cap なし）、
    # trancoUpdater 系は baseMs 1000・multiplier 2（cap なし）で再現する。
    # 1-origin の呼び出し側は attempt - 1 を渡してオフセットを吸収する

Scenario: 境界 — maxMs 超過の attempt は cap 値で頭打ちになる
  Given cap を持つ stepExecutor 系の遅延計算（maxMs 5000）
  When cap を超過する attempt（例: retries が大きく `1000 * 2^retries` が 5000 を超える回）の遅延を計算する
  Then 現行の Math.min 挙動と同一で 5000ms が返る
```

## 受け入れ基準

- [x] `StepExecutor.executeWithStrategy`・`StorageTransaction.withLock` / `withAtomic`・`TrustDbKernel.doInitializeWithRetry`・`TrancoUpdater.updateTrancoList` の遅延計算が `backoffDelayMs` への委譲に置き換わっている
- [x] 各 attempt の遅延値が現行と完全一致（byte-identical）であり、parity テストで pin されている
- [x] 1-origin の呼び出し側（stepExecutor・storageTransaction・trancoUpdater）はオフセット吸収（`attempt - 1` 等）により現行値と一致している
- [x] cap あり（stepExecutor の 5000ms）・cap なし（他4箇所）の挙動が現行どおり再現されている
- [x] `ConflictError` 判定・`ErrorStrategy.RETRY` 判定等の再試行可否の述語は各ドメインに残っている
- [x] jitter 等の振る舞い変更を含まない
- [x] `npm run type-check` / `npm test` が green

## テスト戦略

- parity テスト（新規）: 委譲前の遅延値を期待値として固定する。各系統の代表的な attempt 列（例: 0〜4、stepExecutor 系は cap 到達前後の retries 列）の遅延値を pin する。以降の意図的な値変更はこのテストを更新することで検出可能にする。
- 既存テストの維持: `src/utils/storage/__tests__/` の storageTransaction 系テスト（`storageTransaction-contract.test.ts` 等）と `src/utils/trustDb/__tests__/` の trustDb 系テスト（`trancoUpdater.test.ts` 等）、`src/background/pipeline/__tests__/` の stepExecutor 系テスト（`stepExecutor.test.ts`）が green のままであることを確認する。

## 見積もり

0.5 pt（小規模リファクタ。5箇所の遅延計算の委譲＋parity テスト。遅延値の変更は含まない）。

## 実装ガイド

- 着手時点での確認ポイント: 上記5ファイルの該当関数、`src/utils/backoff.ts` の契約（`baseMs` デフォルト 1000・`multiplier` デフォルト 2・`maxMs` デフォルトは上限なし）、既存テスト（storageTransaction / trustDb / pipeline 関連の vitest）。
- `backoffDelayMs` は 0-origin の `attempt` を想定する。各箇所の現行式との対応は次のとおり（着手時に現物で再確認すること）:
  - stepExecutor 系: `backoffDelayMs(retries, { baseMs: 1000, maxMs: 5000 })`（`retries` はインクリメント後の 1-origin 値をそのまま渡すと `1000 * 2^retries` に一致する）
  - storageTransaction 系（withLock / withAtomic）: `backoffDelayMs(attempt - 1, { baseMs: initialDelay })`（cap なしが現行どおり）
  - TrustDbKernel 系: `backoffDelayMs(attempt, { baseMs: 100 })`（`attempt` は 0-origin のまま。cap なしが現行どおり）
  - trancoUpdater 系: `backoffDelayMs(attempt - 1, { baseMs: baseDelay })`（`attempt` は 1-origin。cap なしが現行どおり）
- 遅延値を将来変えたい場合（jitter 導入等）は、先に parity テストで現行値を pin した上で、別 PBI として意図的に変えること。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
