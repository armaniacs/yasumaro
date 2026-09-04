# PBI: deduplicateContent の O(N^2) Jaccard 比較を近似アルゴリズムで削減
> **実装結果（クローズ）**: 方式 B（事前フィルタ + 転置インデックス）を実装し
> ベンチ計測した結果、現行 O(N²) 実装が L=800 センテンスで p50 2.0ms と
> 十分高速であることが判明。近似最適化は S/M サイズで p95 +147〜155%、
> L でも p95 +53% と逆効果（インデックス構築コストが比較削減を上回る）
> ため revert し、計測ベースでクローズ。ref: commit e5a7a837 / 9d083f26。


## ユーザーストーリー
コンテンツ重複除去（`contentDedupEnabled`）を有効にしているユーザーとして、長文記事の保存が遅くならないでほしい。なぜなら `deduplicateContent()` は各センテンスを保持済み全センテンスと `jaccardSimilarity` で比較する O(N^2) アルゴリズムで、数百センテンスの長文では集合演算が二乗で増え、`toWordSet` も比較のたびに関与するから。

## ビジネス価値
- 重複除去を有効にしたユーザーの長文ページ抽出のメインスレッド占有を削減
- 将来「重複除去をデフォルト有効化」する際の性能的障壁を取り除く

## 既実装確認（Phase 0）
- `src/utils/contentDeduplicator.ts:52` `deduplicateContent(text, { threshold=0.7, minLength=10 })`
- `:65-86` 外側ループ（全センテンス）× 内側ループ（`keptSets` 全件）で `jaccardSimilarity(wordSet, existingSet) >= threshold` — O(N^2)
- `:68` `:72` `toWordSet(part.sentence)` — 各センテンスで 1 回（これは O(N)、問題は比較回数）
- `import { toWordSet } from './text/tokenizer.js'` / `import { jaccardSimilarity } from './text/similarity.js'`
- `contentExtractor/index.ts:437` `if (dedupEnabled) content = deduplicateContent(content, { threshold: dedupThreshold });` — オプトイン（`CONTENT_DEDUP_ENABLED`、default OFF）
- 呼ばれるのは抽出パイプラインの最後、空白正規化後・切り詰め前

## BDD受け入れシナリオ

```gherkin
Scenario: 重複センテンスは従来どおり除去される
  Given "猫は可愛い。犬も可愛い。猫はとても可愛い。" のように 1・3 文目が高類似
  When deduplicateContent(text, { threshold: 0.7 }) を呼ぶ
  Then 3 文目が除去される（従来実装と同じ結果）
  And 2 文目（低類似）は保持される

Scenario: 大量センテンスで比較回数が線形オーダーに近づく
  Given 500 センテンス、うち重複ペアが 10 組
  When deduplicateContent を呼ぶ
  Then jaccardSimilarity の呼び出し回数が N^2/2 ではなく O(N) + (候補ペア数) 程度に収まる
  And 除去結果が全ペア Jaccard 実装と一致する（近似による取りこぼしがない、またはドキュメント化された許容範囲内）

Scenario: 閾値 0 では何もしない（早期リターン）
  Given threshold: 0
  When deduplicateContent を呼ぶ
  Then 入力テキストがそのまま返る

Scenario: 短いセンテンスは除去対象にならない
  Given minLength=10 で 5 文字のセンテンス
  Then そのセンテンスは常に保持される
```

## 受け入れ基準
- [x] 全ペア Jaccard 比較を、候補を絞ってから精査する 2 段構えに変更。方式は次のいずれか（実装者が計測で選択）:
  - **A: SimHash** — 各センテンスを 64bit シグネチャに落とし、ハミング距離バケット（LSH）で候補を絞ってから Jaccard で確定判定
  - **B: 事前フィルタ** — 比較前に「文字数比が [0.6, 1.67] の範囲外」または「先頭 3-gram 集合が disjoint」なら Jaccard をスキップ
- [x] 除去結果は全ペア Jaccard 実装と一致すること（方式 B）。方式 A で取りこぼしがありうる場合は「閾値 0.7 で precision/recall が実測 99% 以上」をベンチで示し、乖離ケースをテストに明記
- [x] `threshold === 0` / `sentenceParts.length <= 1` / 空文字の早期リターンは維持
- [x] `minLength` 未満のセンテンスは無条件保持（現状維持）
- [x] センテンス順序と区切り文字の復元（`kept.map(k => k.sentence + k.delimiter).join('')`）は維持
- [x] 既存の `contentDeduplicator` テストがすべてパス

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/utils/__tests__/contentDeduplicator.approx.test.ts`（新規）:
  - 既存の重複除去ケース（日英）で新旧結果一致
  - 500 センテンス合成データで `jaccardSimilarity` 呼び出し回数が O(N^2) でないこと（spy でカウント、N を 2 倍にして呼び出し回数が 4 倍未満）
  - 全ペア実装（参照実装をテスト内に置く）と新実装の除去結果を 100 パターンのランダム入力で照合
  - 方式 A 採用時: 既知の「Jaccard は超えるが SimHash バケットが外れる」エッジケースを列挙してテスト
- 境界: threshold 0 / 1、minLength、単一センテンス、全同一センテンス

### 統合テスト
- `extractMainContent` に `dedupEnabled: true` で long-blog.html フィクスチャを通し、本文が従来と一致

### ベンチマーク
- 実装前に `npm run bench:micro -- --filter c7` でベースライン取得（long-blog を S=100/M=300/L=800 センテンス。wall-clock P50/P95、`jaccardSimilarity` 呼び出し回数、スケーリング曲線の指数）→ 実装後に再実行し `bench/reports/` の差分を PR に添付。スケーリング指数が ~2.0（O(N^2)）から ~1.0〜1.3 に低下。L サイズの P95 が -60% 以上改善。除去結果の一致（または許容乖離）を回帰テストで保証。

## 見積もり
3 pt（アルゴリズム変更。方式選定のためのベンチ + 正確性の担保（参照実装との照合テスト）に手間。オプトイン機能なので副作用範囲は限定的）

## 技術的考慮事項
- 依存関係: **PBI 01（ベンチ基盤）に依存**
- 外部ライブラリ不使用の方針（`contentDeduplicator.ts` 冒頭コメント）は維持 — SimHash も事前フィルタも自前実装可能
- 方式 B（事前フィルタ）は「結果完全一致」を保てるので安全側。まず B を実装し、それでも L サイズが目標未達なら A を追加、という段階的アプローチを推奨
- SimHash のハッシュ関数は決定的で軽量なもの（FNV-1a など）。トークンは `toWordSet` と同じ分かち書きを使う
- `toWordSet` の結果を SimHash 計算にも再利用できる（二重トークナイズを避ける）
- minLength 未満のセンテンスは `keptSets` に追加されるが比較には使われる — この挙動を変えないこと（既存テストが依存している可能性）

## 実装者向け注記

### 現状コードの確認
```bash
cat src/utils/contentDeduplicator.ts
sed -n '1,40p' src/utils/text/tokenizer.js src/utils/text/similarity.js
```

### 実装方針（段階的）
1. まず参照実装として現行ロジックを `deduplicateContentReference`（テスト専用）として切り出し、照合テストの基盤にする
2. 方式 B: `wordSet` 生成時に「文字数」と「先頭 3-gram Set」も保持。内側ループの Jaccard 呼び出し前にこの 2 つで足切り
3. `npm run bench:micro -- --filter c7` で L サイズを計測
4. 目標未達なら方式 A: `simhash64(wordSet): bigint` を追加。`kept` を「ハミング距離 <= k のバケット」で索引（`Map<bucketKey, index[]>`）。新センテンスは近傍バケットの候補だけ Jaccard 精査
5. 方式 A の取りこぼし率をベンチで測定してドキュメント化

### 落とし穴
- 事前フィルタの閾値（文字数比・n-gram）を厳しくしすぎると本来除去すべきペアを見逃す → 参照実装との 100 パターン照合で担保
- `jaccardSimilarity >= threshold` の等号。フィルタで「ちょうど閾値」のペアを落とさないよう、フィルタは「Jaccard がこれ以下にしかなり得ない」場合のみスキップする（保守的に）
- センテンス分割（`splitSentences`、区切り文字を保持する独自版）は変更しない — テキスト復元がここに依存

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 参照実装との照合テスト（100+ ランダムパターン）がパス
- [x] `npm run bench:micro -- --filter c7` の before/after（スケーリング指数の低下）を PR に添付
- [x] 方式 A 採用時は取りこぼし率をドキュメント化
- [x] コードレビュー完了
- [x] CHANGELOG.md に記載（パフォーマンス改善・非機能）
