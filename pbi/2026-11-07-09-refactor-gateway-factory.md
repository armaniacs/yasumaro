# PBI 2026-11-07-09: messaging gateway factory による 3 gateway の共通化

## Header

- Rank: 9/9 (holistic improvement round)
- RICE: 0.64 (Reach 4 / Impact 1 / Confidence 0.8 / Effort 5)
- Dependency: なし (単独で実施可能)
- Theme: messaging gateway twins + per-file timeout aliases
- Estimate: 5SP

## User Story

開発者として、3 つの messaging gateway の重複した envelope + timeout + normalize 処理を 1 つの factory にまとめたい。外部仕様を変えずに保守性を上げ、timeout 定数の意味を用途別に整理したい。

## Background

3 つの gateway は envelope 作成 + `sendWithPolicy` + `asSuccessResponse` による normalize の骨格を共有し、自己注釈でも mirror image と明記されている。

- `src/messaging/askHistoryGateway.ts:18-46`: `ASK_HISTORY_TIMEOUT_MS` 定義と `askHistory()` + `normalizeAskHistoryResponse` の骨格
- `src/messaging/regenerateSummaryGateway.ts:18-54`: `REGENERATE_TIMEOUT_MS` 定義と `regenerateSummary()` + `normalizeRegenerateResponse` の骨格
- `src/messaging/pendingRecordGateway.ts:37-42`: `PENDING_RECORD_TIMEOUT_MS` と `PENDING_RECORD_TIMEOUT_ERROR` の timeout 契約定義 (本体 `recordPendingPage()` は 42-73 行目)

確認済み事実:

- `ASK_HISTORY_TIMEOUT_MS` と `REGENERATE_TIMEOUT_MS` はどちらも `60_000`
- `PENDING_RECORD_TIMEOUT_MS` は `20000`
- 3 ファイルとも `asSuccessResponse` による normalize を使う
- 提案は `defineGateway({type, timeoutMs, timeoutError, invalidMessage})` 形式の宣言的 factory を新設し、既存 3 gateway を外部仕様同一のまま委譲させること
- timeout 定数は用途別の 2 定数 (record 用 20s / AI 用 60s) に集約する

## BDD Scenarios

### Scenario 1: 既存呼び出しは factory 経由でも結果が変わらない

```gherkin
Given 既存の `askHistory()` / `regenerateSummary()` / `recordPendingPage()` の呼び出し元がある
When gateway 内部実装だけを `defineGateway` への委譲に置き換える
Then 戻り値の型と成功時 / 失敗時 / timeout 時の振る舞いは変更前と同一になる
```

### Scenario 2: timeout 定数の用途別集約

```gherkin
Given record 用 20s と AI 用 60s の 2 用途だけが存在する
When `ASK_HISTORY_TIMEOUT_MS` と `REGENERATE_TIMEOUT_MS` を AI 用 60s 定数に一本化する
And `PENDING_RECORD_TIMEOUT_MS` を record 用 20s 定数として残す
Then 各 gateway の実効 timeout 値 (20s / 60s) は変更前と同一になる
```

### Scenario 3: 不正応答の扱いが factory で一元化される

```gherkin
Given 不正な応答 payload を受け取った場合
When `defineGateway` が `invalidMessage` を使って `asSuccessResponse` を呼ぶ
Then 3 gateway とも従来と同じ `SendFailure` 形式で失敗を返す
```

## Acceptance Criteria

- [ ] AC1: `defineGateway({type, timeoutMs, timeoutError, invalidMessage})` 形式の factory が `src/messaging/` に追加される
- [ ] AC2: `askHistory` が factory への委譲になり、export された関数名・引数・戻り値の型が変わらない
- [ ] AC3: `regenerateSummary` が factory への委譲になり、export された関数名・引数・戻り値の型が変わらない
- [ ] AC4: `recordPendingPage` が factory への委譲になり、export された関数名・引数 (`opts.timeoutMs` を含む)・戻り値の型が変わらない
- [ ] AC5: 外部から見た振る舞い (envelope の type、timeout 時間、timeout error、normalize 失敗文言) が 3 gateway とも変更前と同一である
- [ ] AC6: timeout 定数が用途別の 2 定数 (record 用 20s / AI 用 60s) に集約され、AI 系 2 gateway の実効値 60000 と record 系の実効値 20000 が保たれる

## Test Strategy

- 既存 messaging 関連テスト (`sendWithPolicy`、各 gateway の timeout / normalize テスト) を全て実行し、回帰なしを確認する
- `npm run type-check` で型エラーの追加がないことを確認する
- `npm run lint` (または同等の lint コマンド) で新規 factory と編集 3 ファイルの警告追加がないことを確認する
- 新規テストは factory の委譲確認に絞り、既存テストの重複追加はしない

## DoD (Definition of Done)

- [ ] AC1 から AC6 を全て満たす
- [ ] 既存 messaging テストが全て成功する
- [ ] type-check が成功する
- [ ] lint が成功する
- [ ] 外部仕様の変更がないことを差分レビューで確認する
