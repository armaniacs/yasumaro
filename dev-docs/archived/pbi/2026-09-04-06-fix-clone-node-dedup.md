# PBI: AI 要約クレンジングの cloneNode 多重生成を 1 回に統一

## ユーザーストーリー
ブラウジング中のユーザーとして、大きな記事ページでの自動保存が重くならないでほしい。なぜなら `extractMainContent()` が候補要素を `cloneNode(true)` でディープクローンし、さらに `cleanseAISummaryContent()` の内部でもう一度 `element.cloneNode(true)` するため、大きな記事ノード（数 MB 相当）のディープコピーが 2 回発生し、加えて `outerHTML` の文字列化も複数回起きるから。

## ビジネス価値
- 大きなページでのクローンコスト（メモリ確保 + ノードコピー）を半減
- GC 圧（一時的な巨大 DOM ツリー）を軽減

## 既実装確認（Phase 0）
- `src/utils/contentExtractor/index.ts:179` `const clone = firstCandidate.cloneNode(true) as Element;`（cleanseEnabled 経路）
- `index.ts:267` `const clone = firstCandidate.cloneNode(true) as Element;`（AI 要約のみ経路）
- `index.ts:328` `const clone = document.body.cloneNode(true) as Element;`（候補なしフォールバック）
- `src/utils/aiSummaryCleaner/index.ts:127` `const clone = element.cloneNode(true) as Element;` — **呼び出し側が既に clone を渡しているのに内部で再クローン**
- `aiSummaryCleaner/index.ts:67` `:92` `new Blob([element.outerHTML || '']).size` — HTML 全体シリアライズ 2 回（PBI 04 と関連）

## BDD受け入れシナリオ

```gherkin
Scenario: クレンジング全体でクローンは 1 回だけ
  Given cleanseEnabled=true かつ aiSummaryCleanseEnabled=true
  When extractMainContent が候補要素をクレンジングする
  Then cloneNode(true) の呼び出しは 1 回だけ（オーケストレータが作る 1 個）
  And その 1 個の clone に対してコンテンツクレンジングと AI 要約クレンジングが順に適用される

Scenario: 呼び出し側が clone 済みなら内部で再クローンしない
  Given cleanseAISummaryContent に既にクローンされた要素を渡す（alreadyCloned フラグ付き）
  When クレンジングを実行する
  Then 内部で cloneNode は呼ばれない
  And 渡された要素が直接変更される（呼び出し側の責任で clone 済みのため安全）

Scenario: クレンジング結果は従来と一致する
  Given 既存テストのフィクスチャ
  When 新実装でクレンジングする
  Then 削除要素数・残存テキスト・cleansedReason が従来と一致する
```

## 受け入れ基準
- [x] `cleanseAISummaryContent()` に `alreadyCloned?: boolean`（または `mutateInPlace?: boolean`）オプションを追加。true のとき内部の `cloneNode`（`aiSummaryCleaner/index.ts:127`）をスキップし、渡された要素を直接変更
- [x] `extractMainContent()` の 3 経路すべてで、オーケストレータが作った 1 個の clone を `cleanseContent` → `cleanseAISummaryContent(clone, { alreadyCloned: true })` の順で使い回す
- [x] `countAISummaryTargets()`（削除せず数えるだけ）は live DOM に対して呼ばれるので `alreadyCloned` は付けない（現状維持）
- [x] クレンジング結果（`totalRemoved` / `removed` マップ / テキスト）が従来実装とバイト単位で一致
- [x] 既存の `aiSummaryCleaner` / `contentExtractor` テストがすべてパス
- [x] `cleanseAISummaryContent` を単独で（clone なしで）呼ぶ既存の利用箇所が壊れない（default は従来どおり内部クローン）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/utils/aiSummaryCleaner/__tests__/index.clone-dedup.test.ts`（新規）:
  - `Element.prototype.cloneNode` を spy、`extractMainContent` フルパスで呼び出し 1 回
  - `cleanseAISummaryContent(el, { alreadyCloned: true })` で `cloneNode` 0 回、かつ渡した `el` 自体が変更される
  - `alreadyCloned` 省略時は従来どおり内部クローンし、元要素は不変
  - 新旧で `totalRemoved` / `removed` / `clone.textContent` が一致（既存フィクスチャ）

### 統合テスト
- `pageContentPipeline` 経由で 3 経路（cleanseEnabled / AI のみ / 候補なし）すべてが従来と同じ本文を返す

### ベンチマーク
- 実装前に `npm run bench:micro -- --filter c4` でベースライン取得（fixtures news-article を S/M/L。wall-clock P50/P95、heapUsed 差分、`cloneNode` 呼び出し回数）→ 実装後に再実行し `bench/reports/` の差分を PR に添付。`cloneNode` 回数が 2→1。heapUsed ピーク差分が減少（目標: L で -25% 以上）。P95 改善。クレンジング結果の一致を回帰テストで保証。

## 見積もり
2 pt（オプション追加は小さいが、3 経路の配線と「結果一致」の慎重な検証が必要。副作用リスクあり）

## 技術的考慮事項
- 依存関係: **PBI 01（ベンチ基盤）に依存**。PBI 04（バイト計測遅延化）と同じファイルを触るため、**04 → 06 の順で実装するとコンフリクトが減る**（backlog 順もそうなっている）
- 「渡された要素を直接変更する」のは呼び出し側が clone 済みを保証する契約。契約違反（live DOM を渡して alreadyCloned=true）は呼び出し側のバグ → 型 or ドキュメントで明示
- `cleanseContent`（コンテンツクレンジング、`contentCleaner.ts`）も clone に対して動く。こちらは既に呼び出し側 clone を使っている（`index.ts:185`）ので変更不要
- 副作用: クレンジング結果がわずかでも変わると保存される要約テキストが変わる → 回帰テストのフィクスチャカバレッジが命

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "cloneNode\|outerHTML" src/utils/contentExtractor/index.ts src/utils/aiSummaryCleaner/index.ts
sed -n '55,135p' src/utils/aiSummaryCleaner/index.ts
```

### 実装方針
1. `AiSummaryCleanseOptions` に `alreadyCloned?: boolean` を追加
2. `cleanseAISummaryContent`（`index.ts:127` 付近）: `const target = options.alreadyCloned ? element : element.cloneNode(true) as Element;` に変更、以降 `target` を使う
3. `contentExtractor/index.ts` の `runAiSummaryCleanse` 呼び出し 3 箇所で、既に作った `clone` を渡し `alreadyCloned: true` を付与
4. `runAiSummaryCleanse`（`index.ts:50`）のシグネチャで `options` に `alreadyCloned` を通す
5. 新旧一致テストを厚めに

### 落とし穴
- `cleanseAISummaryContent` が返す `preCleanseText`（フォールバック用）は「クレンジング前のテキスト」。内部クローンを外すと `element.textContent` を**変更前に**キャプチャする必要がある（`runAiSummaryCleanse:55` は既に `preCleanseText = clone.textContent` を先に取っている — 順序を維持）
- `countAISummaryTargets` と `cleanseAISummaryContent` でコードパスが分岐している場合、count 側に `alreadyCloned` を誤って適用しない
- E2E の要約テキスト（`recording-traceId.spec.ts` 等）が変わらないこと

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `npm run bench:micro -- --filter c4` の before/after を PR に添付
- [x] クレンジング結果の新旧一致を回帰テストで保証
- [x] コードレビュー完了
- [x] CHANGELOG.md に記載（パフォーマンス改善・非機能）
