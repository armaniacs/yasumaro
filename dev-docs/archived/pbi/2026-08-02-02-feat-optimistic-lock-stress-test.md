# PBI: 2026-08-02-02-feat-optimistic-lock-stress-test

## ユーザーストーリー
開発者として、ストレージ更新時の楽観的ロック機構が極限状態でも正しく動作することを検証したい、なぜなら複数のサービスワーカーコンテキストや非同期処理が同時に同じ設定値を更新しようとした際に、データが消失したり不整合が起きたりすることを完全に防止したいから

## ビジネス価値
- **データ整合性の保証**: 競合発生時に常に最新の状態が維持され、上書き消失（Lost Update）が起きないことを数学的に保証する
- **信頼性の向上**: エッジケースにおけるクラッシュや予期せぬ動作を排除し、堅牢なストレージ操作を実現する

## BDD受け入れシナリオ

```gherkin
Scenario: Concurrent Updates with Successful Recovery
  Given A storage key exists with version 1
  When 10 concurrent updates are attempted via `withOptimisticLock`
  Then All updates that did not exceed maxRetries eventually succeed
  And The final version of the key is exactly 1 + (number of successful updates)
  And The final value reflects the result of all successful modifications

Scenario: Exhaustion of Retries under Heavy Contention
  Given A storage key exists with version 1
  When Extreme contention occurs such that a request fails all retry attempts
  Then A `ConflictError` is thrown
  And The storage state remains consistent (no partial or corrupted writes)
  And The error contains the expected vs actual version numbers
```

## 受け入れ基準
- [ ] 10〜50件の同時更新リクエストを擬似的に発生させ、データ整合性が維持されることを確認するテストを実装すること
- [ ] 指数バックオフが正しく機能し、リトライ間隔が広がっていることを検証すること
- [ ] `maxRetries` 到達時に正しく `ConflictError` がスローされ、システムがハングしないことを確認すること

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] (適用外: ストレージユーティリティのため統合/単体テストで完結させる)

### 統合テスト
- [ ] `chrome.storage.local` のモックを使用し、実際のリトライループが回ることを検証する統合テスト

### 単体テスト
- [ ] `performCasUpdate` のバージョンチェックロジックの境界値テスト
- [ ] `withOptimisticLock` のリトライ回数制限とエラーハンドリングのテスト
- [ ] 同時実行シミュレーション（Promise.all を使用した競合発生テスト）

## 実装アプローチ
- **Outside-In**: `withOptimisticLock` を呼び出す高レベルな競合テストから書き始め、内部の `performCasUpdate` の検証を深める
- **Stress Testing**: `Promise.all` で大量の更新関数を同時に走らせ、CAS失敗 $\rightarrow$ リトライ $\rightarrow$ 成功 のサイクルを意図的に発生させる

## 見積もり
5ストーリーポイント

## 技術的考慮事項
- 依存関係: `src/utils/optimisticLock.ts`
- テスタビリティ: `chrome.storage.local` を適切にモック化し、タイミングを制御できる環境を構築する必要がある
- 非機能要件: リトライによるパフォーマンス劣化が許容範囲内であること

## 実装者向け注記

### 現状コードの確認
```bash
cat src/utils/optimisticLock.ts
```
`withOptimisticLock` 関数がメインロジックであり、内部で `performCasUpdate` を呼んでいる。

### 実装手順
1. `src/utils/__tests__/optimisticLock-stress.test.ts` を新規作成
2. `chrome.storage.local.get/set` のモックを作成し、意図的にバージョン不一致を返すシナリオを実装
3. 同時実行リクエストを投げ、最終的なバージョン番号と値が正しいか検証するテストを実装
4. リトライ回数上限に達した時の `ConflictError` 検証を追加

### 落とし穴
- Jestの非同期テストで、リトライの `setTimeout` が原因でタイムアウトエラーになる可能性があるため、`vi.useFakeTimers()` 等の検討が必要

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 極端な競合条件下でもデータ不整合が発生しないことが証明される
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
