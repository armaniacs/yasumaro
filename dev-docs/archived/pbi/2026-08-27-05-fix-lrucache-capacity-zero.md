# PBI: LruCache capacity 0 の不変条件違反修正

## ユーザーストーリー
開発者として、`LruCache` の `maxSize=0` 時に `size <= maxSize` 不変条件が保たれるようにしたい、なぜなら現在は `onEvict(undefined, undefined)` を呼び `size=1` を許容しテストがバグを固定しているから。

## 優先度
- 順位: 5 / 8
- RICEスコア: 160（Reach=10 / Impact=1 / Confidence=80% / Effort=0.05）
- 根拠: capacity 0 は稀 (Reach=10)。不変条件違反は将来の prepared statement キャッシュで予期せぬ evict を招く (Impact=1)。修正は 1 分岐で Effort 極小。

## なぜなぜ分析
- なぜ違反するか: `store.size >= maxSize` が `0>=0` で true、空 Map から `undefined` を evict するため
- なぜテストが気づかないか: 包括テストが `expect(size).toBe(1)` で違反を正常として固定した
- なぜ capacity 0 が渡されるか: 設定ミスや動的計算での edge case
- 解: `maxSize <=0` は即時 `onEvict` せず `set` を無視するか `throw` し、不変条件を保つ

## BDD受け入れシナリオ
Scenario: ハッピーパス — capacity 1 は正常に evict する
  Given `LruCache(1)` を生成する
  When `set(1,'a')` 後に `set(2,'b')` する
  Then `evicted=[1]` で `size===1` である

Scenario: エッジケース — capacity 0 は保存しない
  Given `LruCache(0)` を生成する
  When `set(1,'a')` する
  Then `onEvict` は `undefined` で呼ばれず `size===0` である

## 受け入れ基準
- [x] `src/offscreen/lruCache.ts:35-39` で `maxSize <=0` 時に `onEvict(undefined)` が呼ばれない
- [x] `src/offscreen/__tests__/lruCache-comprehensive.test.ts:27-35` の期待値が `size===0` に修正されている
- [x] `value === undefined` を値として格納した場合の LRU 更新挙動が文書化または修正されている
- [x] 既存 205 ケースがパスする

## テスト戦略
- 単体: capacity 0/1/10000、get による MRU 昇格、evict コールバックの値検証
- 統合: prepared statement キャッシュでの利用シナリオを想定した連続 set/get
- E2E: 不要

## 見積もり
0.5pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
