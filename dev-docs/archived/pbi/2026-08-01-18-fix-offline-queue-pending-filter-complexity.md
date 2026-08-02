# PBI: retryAll()のpending配列フィルタ処理をO(n)に改善する

**作成日**: 2026-08-01
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（内部ロジックの効率化のみ、外部から見た挙動は変わらない）

---

## 背景

直前のコードレビュー（fix-0801bブランチ、PBI-14/15実装分）での指摘。`src/background/offlineNetworkQueue.ts` の `retryAll()` 内、ループの各イテレーションで `pending` 配列全体を `filter` しており、ループ全体でO(n²)になっている。

```ts
let pending = [...jobsToProcess];
...
for (const job of jobsToProcess) {
  pending = pending.filter((j) => j.id !== job.id);  // O(n) × n回 = O(n²)
  ...
}
```

`MAX_JOBS_PER_CYCLE = 20`（PBI-15で導入）により1サイクルの処理対象は最大20件に制限されているため、現状は実害がない（20×20=400回の比較で無視できるコスト）。ただし将来 `MAX_JOBS_PER_CYCLE` の値が引き上げられた場合に備え、効率的な実装にしておく価値がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "pending.filter\|MAX_JOBS_PER_CYCLE" src/background/offlineNetworkQueue.ts
```

`jobsToProcess`（処理対象）と `queue`（全件）が同じ順序を保っていること、`pending` が「未処理の残り」を表す配列であることを確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 大量のジョブを処理してもretryAll()の計算量がO(n)に収まる
  Given MAX_JOBS_PER_CYCLE件のジョブがキューにある
  When retryAll()がすべてのジョブを処理する
  Then pending配列からの処理済みジョブの除去がO(1)〜O(n)（配列全体のfilterではない）の操作で行われる

Scenario: 既存のretryAll()関連テストが回帰しない
  Given 変更後のretryAll()実装
  When 既存のoffline queue関連テストを実行する
  Then 全てパスする（成功時・失敗時・上限到達時・サイクル持ち越しの挙動が変わらない）
```

## 受け入れ基準
- [ ] `pending` の管理を `filter` によるO(n)除去の繰り返しから、`Set`（処理済みID管理）または `shift()`（`jobsToProcess`と同じ順序で処理される前提を利用）などのO(1)操作に置き換える
- [ ] `saveQueue([...remaining, ...pending, ...untouched])` に渡す配列の中身・順序が変更前と同じであることを確認する
- [ ] 既存の `offlineNetworkQueue` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 既存の `offlineNetworkQueue.test.ts` のテスト（成功時削除、失敗時retryCount増加、上限超過時の持ち越し等）がすべて変更なしでパスすることを確認する
- 新規テストは不要（内部実装の効率化のみで、外部から見た挙動・戻り値・保存内容は変わらないため）

## 実装アプローチ
- **Outside-In**: 既存テストを先に実行しグリーンであることを確認 → 実装を変更 → 再度グリーンであることを確認（挙動が変わらないことを保証するリファクタリング）
- **Red-Green-Refactor**: 今回は新しい振る舞いを追加するのではなく、既存の振る舞いを保ったままの内部改善なので、既存テストがセーフティネットとして機能する

## 見積もり

1pt（1関数内の実装置き換えのみ）

## 技術的考慮事項
- 依存関係: `src/background/offlineNetworkQueue.ts` の `retryAll()` のみ
- テスタビリティ: 既存テストで十分カバー可能。挙動を変えないリファクタリングのため新規テスト追加は必須ではない
- 非機能要件: パフォーマンス（現状は無視できるレベルだが将来のスケール変更に備える）

## 実装手順（例）

`shift()` を使う場合（`jobsToProcess` と同じ順序で処理する前提が成り立つため、最もシンプル）:

```ts
const pending = [...jobsToProcess];
const remaining: OfflineJob[] = [];

for (const job of jobsToProcess) {
  pending.shift(); // 現在処理中のjobを先頭から除去（filterよりO(1)）
  ...
}
```

`Set` を使う場合（処理順序への依存を避けたい場合）:

```ts
const processedIds = new Set<string>();
for (const job of jobsToProcess) {
  processedIds.add(job.id);
  const pending = jobsToProcess.filter((j) => !processedIds.has(j.id)); // 依然filterだが意図は明確
  ...
}
```
上記2案のうち、`jobsToProcess`が`queue.slice(...)`由来でforループの反復順と完全に一致することを利用した`shift()`案がシンプルで推奨。

## 落とし穴
- `shift()`案を採用する場合、`jobsToProcess`の反復順序とforループのfor-of反復順序が一致していることが前提。配列のfor-ofはインデックス順で反復されるため通常は問題ないが、将来ループの実装が変わった場合に暗黙の前提が壊れるリスクがある。コメントで前提条件を明記すること。

## Definition of Done
- [x] `pending`除去処理がO(n²)からO(n)に改善されている
- [x] 既存の`offlineNetworkQueue`関連テストが全てパスする
- [x] `pbi/00-INDEX.md` が更新されている

## 実装メモ（2026-08-01完了）

`pending.filter((j) => j.id !== job.id)` を `pending.shift()` に置き換えた。`jobsToProcess`（`queue.slice(0, MAX_JOBS_PER_CYCLE)`由来）とforループの反復順序が一致することを利用し、O(n²)からO(n)に改善。挙動（保存内容・順序）は変更前と完全に同一であることを既存17件のテストで確認済み。`npm run validate`（型チェック+vitest全件7336件）成功。

## 関連
- コードレビュー: fix-0801bブランチ未コミット変更（PBI-13〜16実装）に対するレビュー、Suggestions #1（Performance）
- 対象コード: `src/background/offlineNetworkQueue.ts`（`retryAll()`内、`pending.filter`の箇所）
- 前提PBI: `dev-docs/archived/pbi/2026-08-01-15-fix-offline-queue-rate-limit.md`（`MAX_JOBS_PER_CYCLE`導入により現状は実害なしと判定された経緯）
