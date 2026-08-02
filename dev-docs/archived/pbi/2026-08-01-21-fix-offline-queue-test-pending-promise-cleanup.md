# PBI: offlineNetworkQueue.test.tsの意図的な未解決Promiseの扱いを明確にする

**作成日**: 2026-08-01
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（テストコードのみの変更）

---

## 背景

直前のコードレビュー（fix-0801bブランチ、PBI-14実装分）での指摘。`src/background/__tests__/offlineNetworkQueue.test.ts` の「persists retryCount progress per job, not only after the full pass completes」テストが、`retryAllPromise` を意図的に未解決のまま放置してテストを終了する設計になっている。

```ts
const retryAllPromise = queue.retryAll(async (job) => {
  if ((job.payload as { url: string }).url === 'https://b.com') {
    resolveSecondJob?.();
    // Never resolves — simulates the Service Worker being torn down
    // while the second job is still in flight.
    return new Promise<boolean>(() => {});
  }
  return false;
});

await secondJobStarted;
// ... アサーション ...
void retryAllPromise; // left pending intentionally; test ends here
```

これは「Service Workerが処理途中で終了する」状況をシミュレートするための意図的な設計であり、現状は全テストパスしている。ただし、以下の懸念が残る：
- ハンドラが永久に解決しない `Promise` を返すため、そのPromiseチェーン自体はテスト終了後もイベントループ上に残留しうる
- `unhandledRejection` が発生しないことは自明ではなく、読み手が意図を読み取りにくい
- vitestのテスト分離・タイマー管理と干渉するリスクがゼロとは言い切れない

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "persists retryCount progress per job" -A 30 src/background/__tests__/offlineNetworkQueue.test.ts
npx vitest run src/background/__tests__/offlineNetworkQueue.test.ts --reporter=verbose
```

現状のテストが警告なくパスすることを確認し、`unhandledRejection` やタイムアウト警告が出力されていないかコンソール出力を確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: テストの意図が明確にコメントされている
  Given retryAllPromiseを意図的に未解決のまま残すテスト
  When コードを読む
  Then なぜPromiseを解決させないのか、unhandledRejectionが発生しない理由がコメントで説明されている

Scenario: テスト終了後にリソースリークが起きない
  Given テストが完了した状態
  When 後続のテストが実行される
  Then 前のテストの未解決Promiseによる干渉（タイマーリーク、モック状態の汚染等）が発生しない
```

## 受け入れ基準
- [ ] 未解決のまま残す設計を維持する場合、なぜそれが安全か（`unhandledRejection`が発生しない理由、他テストに影響しない理由）を明示するコメントを追加する
- [ ] 可能であれば、テスト末尾で `resolveSecondJob` に対応する形でハンドラのPromiseも解決させ、`retryAllPromise` を `await` してからテストを終える形に変更する（クリーンアップを明示的に行う）
- [ ] 既存のテスト全体（他のテストへの影響がないこと）が引き続きパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 該当テスト自体を修正対象とする。既存のアサーション内容（1件目のジョブのretryCountが1であることの検証）は変更しない
- 前後のテストが独立して実行されることを確認する（`vitest run`で全体を実行し、テスト順序に依存した失敗がないことを確認）

## 実装アプローチ
- **Outside-In**: まず現状のテストをそのまま実行し、警告の有無を確認する（調査） → コメント追加、または明示的なクリーンアップロジックを追加する

## 見積もり

1pt（1テストケースの修正のみ）

## 技術的考慮事項
- 依存関係: `src/background/__tests__/offlineNetworkQueue.test.ts` のみ
- テスタビリティ: 既存のテスト基盤（`storage` Mapベースのモック）をそのまま利用
- 非機能要件: テストの可読性・保守性向上が目的

## 実装手順（例）

クリーンアップを明示的に行う場合、ハンドラ内で保持したresolve関数を使って最後にPromiseを解決させる:

```ts
it('persists retryCount progress per job, not only after the full pass completes', async () => {
  await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://a.com' } });
  await queue.enqueue({ type: 'ai_summary', payload: { url: 'https://b.com' } });

  let resolveSecondJob: (() => void) | undefined;
  let resolveSecondJobHandler: ((success: boolean) => void) | undefined;
  const secondJobStarted = new Promise<void>((resolve) => {
    resolveSecondJob = resolve;
  });

  const retryAllPromise = queue.retryAll(async (job) => {
    if ((job.payload as { url: string }).url === 'https://b.com') {
      resolveSecondJob?.();
      return new Promise<boolean>((resolve) => {
        resolveSecondJobHandler = resolve;
      });
    }
    return false;
  });

  await secondJobStarted;

  const persisted = storage['offline_network_queue'] as OfflineJob[];
  const jobA = persisted.find((j) => (j.payload as { url: string }).url === 'https://a.com');
  expect(jobA?.retryCount).toBe(1);

  // Explicit cleanup: resolve the in-flight handler and await retryAll()
  // so no pending Promise chain outlives this test.
  resolveSecondJobHandler?.(false);
  await retryAllPromise;
});
```

## 落とし穴
- クリーンアップのために `resolveSecondJobHandler?.(false)` を呼ぶと、2件目のジョブも `retryAll()` の残りの処理（retryCount増加、saveQueue呼び出し）が走る。アサーション対象（1件目のretryCount）には影響しないはずだが、念のためクリーンアップ後に追加のアサーションを行わないよう注意する

## Definition of Done
- [x] テストの意図（未解決Promiseを残す理由、または明示的クリーンアップ）が明確になっている
- [x] 既存のテストスイート全体が警告なくパスする
- [x] `pbi/00-INDEX.md` が更新されている

## 実装メモ（2026-08-01完了）

PBI本文の実装手順通り、明示的クリーンアップ方式を採用した。`resolveSecondJobHandler`という変数を追加し、2件目のジョブハンドラのPromiseのresolve関数を保持。テスト末尾でアサーション後に`resolveSecondJobHandler?.(false)`を呼びハンドラを解決させ、`await retryAllPromise`でretryAll()自体の完了も待ってからテストを終える形に変更した。`--reporter=verbose`で実行し、`unhandledRejection`等の警告が出力されないことを確認済み。全17件パス。
- コードレビュー: fix-0801bブランチ未コミット変更（PBI-13〜16実装）に対するレビュー、Suggestions #4（Test Coverage）
- 対象コード: `src/background/__tests__/offlineNetworkQueue.test.ts`（`persists retryCount progress per job`テスト）
- 前提PBI: `dev-docs/archived/pbi/2026-08-01-14-fix-offline-queue-alarm-await.md`（このテストが検証するジョブ単位保存機能の導入経緯）
