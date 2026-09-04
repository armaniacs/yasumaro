# PBI: calculateTextScore の事前計算・メモ化と innerText 排除

## ユーザーストーリー
ブラウジング中のユーザーとして、ページを閉じる/離れる際のコンテンツ抽出でメインスレッドが長時間ブロックされないでほしい。なぜなら `findMainContentCandidates()` が `candidates.sort((a, b) => calculateTextScore(b) - calculateTextScore(a))` で、ソート比較のたびに `calculateTextScore` を呼び、その各呼び出しが部分木の TreeWalker 全走査 + 要素ごとの `innerText` 読み取り（強制同期レイアウト）を行うため、候補数 N に対して O(N log N) 回の DOM 走査が起きるから。

## ビジネス価値
- 抽出処理（自動保存のたびに実行）のメインスレッド占有を削減
- `innerText` による強制リフローを排除し、抽出中のページ描画への干渉を減らす

## 既実装確認（Phase 0）
- `src/utils/contentExtractor/scoring.ts:83` `candidates.sort((a, b) => calculateTextScore(b) - calculateTextScore(a))` — 同ファイル `:97` `:117` にも同一パターンが計 3 箇所
- `calculateTextScore`（`scoring.ts:13-64`）: `innerText`（`:17`）+ TreeWalker で全 ELEMENT 走査、`a` 要素ごとに `innerText?.length`（`:46`）
- ファイル冒頭コメント（`scoring.ts:11`）は「DOM 走査を一度に集約し querySelectorAll 呼び出しを削減」と既に最適化を謳っているが、ソート比較内の再計算でその効果が相殺されている
- `div, section` 全取得経路（`scoring.ts:88`）では候補が数百規模になりうる

## BDD受け入れシナリオ

```gherkin
Scenario: 各候補のスコアは 1 回だけ計算される
  Given 候補要素が 20 個ある
  When findMainContentCandidates() がスコア順ソートを行う
  Then calculateTextScore は 20 回だけ呼ばれる（候補数と一致、O(N log N) ではない）

Scenario: スコアリングで強制リフローが起きない
  Given 候補要素にテキストとリンクが含まれる
  When calculateTextScore がテキスト長とリンク密度を計算する
  Then innerText は参照されず textContent のみが使われる
  And レイアウト関連プロパティ（offsetHeight 等）へのアクセスは 0 回

Scenario: スコア順の結果は従来と一致する
  Given 既存テストのフィクスチャ DOM
  When 新実装で候補を抽出する
  Then 返される候補要素の順序と件数が従来実装と一致する
```

## 受け入れ基準
- [ ] `findMainContentCandidates()` の 3 箇所のソートを「`candidates.map(el => ({ el, score: calculateTextScore(el) }))` → `.sort((a,b) => b.score - a.score)` → `.map(x => x.el)`」に変更。スコア計算は候補あたり 1 回
- [ ] `calculateTextScore` の `innerText` 参照（`scoring.ts:17` `:46`）を `textContent` に置換。可視性補正は不要（TreeWalker でリンクテキスト長を集計しているため）
- [ ] スコアの計算式（p×50 / h×100 / list×30 / linkRatio>0.5 で ×0.3）は変更しない
- [ ] 既存の `contentExtractor` / `scoring` 系テストがすべてパス。候補順序・件数の回帰なし
- [ ] `calculateTextScore` は引き続き public export（`contentExtractor/index.ts:31` で re-export）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/utils/contentExtractor/__tests__/scoring.precompute.test.ts`（新規）:
  - `calculateTextScore` を `vi.fn` でラップし、候補 N 個のソートで呼び出し回数が N 回であること
  - `textContent` のみ参照（`innerText` getter を throw するプロキシ要素でも動作すること）
  - 既存フィクスチャで新旧の候補配列（順序・件数）が一致すること
- スコア計算式自体の値は既存テストで担保

### 統合テスト
- `pageContentPipeline` 経由の `extractMainContent` が同じ本文を返すこと（回帰）

### ベンチマーク
- 実装前に `npm run bench:micro -- --filter c2` でベースライン取得（fixtures の spa-heavy を S/M/L で。wall-clock P50/P95、TreeWalker 走査ノード数、reflow カウンタ）→ 実装後に再実行し `bench/reports/` の差分を PR に添付。走査ノード数が候補数依存の O(N log N) から O(N) に落ちていること。P95 が baseline 比で有意に改善（目標: L サイズで -40% 以上）。無関係な指標が +15% 超で悪化していないこと。

## 見積もり
1 pt（局所的変更、3 箇所のソート + 2 箇所の innerText 置換）

## 技術的考慮事項
- 依存関係: **PBI 01（ベンチ基盤）に依存**
- `textContent` は `innerText` と違い CSS の `display:none` を含むが、スコアリング（相対比較）用途では許容。除外要素は `isExcludedElement` で既にフィルタ済み
- `map` で中間オブジェクト配列を作るが、候補は最大でも数百・スコア済みなのでソートは高速。メモリ増は無視できる
- `calculateTextScore` を呼ぶ他の箇所がないか確認（`grep -rn calculateTextScore src`）

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '13,64p;69,119p' src/utils/contentExtractor/scoring.ts
grep -rn "calculateTextScore\|innerText" src/utils/contentExtractor/
```

### 実装手順
1. `scoring.ts` に内部ヘルパー `scoreAndSort(elements: Element[], take: number): Element[]` を追加（map → sort → slice → map）
2. 3 箇所の `candidates.sort(...).slice(...)` を `scoreAndSort(candidates, N)` に置換
3. `calculateTextScore` の `('innerText' in element ? ... : null) || element.textContent || ''` を `element.textContent || ''` に簡約（2 箇所）
4. テスト追加

### 落とし穴
- `slice(0, 1)` / `slice(0, 3)` の take 数がケースで異なる（article/main は 1、asian/hierarchical は 3）— `scoreAndSort` の引数で吸収
- `innerText` を消すと jsdom テストではむしろ挙動が安定する（jsdom の innerText 実装は不完全）。実ブラウザとの差異は「不可視要素のテキストを含むか」だけで、相対順序への影響は軽微

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] `npm run bench:micro -- --filter c2` の before/after を PR に添付
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載（パフォーマンス改善・非機能）
