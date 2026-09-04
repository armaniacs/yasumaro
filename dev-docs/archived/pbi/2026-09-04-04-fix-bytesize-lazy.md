# PBI: コンテンツ抽出のバイト計測を遅延化・単回化

## ユーザーストーリー
ブラウジング中のユーザーとして、自動保存のたびに走るコンテンツ抽出が軽いままであってほしい。なぜなら `extractMainContent()` は 1 回の抽出で `getByteSize()` を 6〜10 回呼び、そのたびに `new TextEncoder().encode(str)` で文字列（`document.body.textContent` は長いページで数百 KB〜MB）を丸ごとエンコードし、さらに `aiSummaryCleaner/index.ts` では `new Blob([element.outerHTML])` で HTML 全体を 2 回シリアライズしているから。これらのバイト数は診断パネル表示時にしか使われない。

## ビジネス価値
- 診断パネルを開かない大多数のユーザーの抽出処理から、重い文字列生成・エンコードを排除
- 抽出のメインスレッド占有と一時オブジェクト生成（GC 圧）を削減

## 既実装確認（Phase 0）
- `src/utils/contentExtractor/index.ts:38` `getByteSize(str) { return new TextEncoder().encode(str).length; }`
- 呼び出し箇所: `index.ts` の `:57 :152 :159 :182 :192 :260 :287 :322 :331 :340 :379 :414 :420` — `pageBytes` / `candidateBytes` / `originalBytes` / `cleansedBytes` / `_contentBytes` / フォールバック再計算
- `pageBytes = getByteSize(document.body.textContent || '')`（`:152` `:331`）が最重量（body 全体）
- `src/utils/aiSummaryCleaner/index.ts:67` `const bytesBefore = new Blob([element.outerHTML || '']).size;` / `:92` `bytesAfter`
- これらのバイト値は `ExtractResult` に格納され、最終的に診断パネル（`src/dashboard/panels/diagnostic/`）・ファネル表示でのみ消費される。`returnInfo=false`（通常の自動保存経路）では `ExtractResult` すら返さず `content` 文字列だけ返す（`index.ts:527`）

## BDD受け入れシナリオ

```gherkin
Scenario: 通常の自動保存経路ではバイト計測を行わない
  Given returnInfo=false（診断情報不要）で extractMainContent を呼ぶ
  When 抽出が完了する
  Then TextEncoder().encode は 0 回呼ばれる
  And document.body.textContent の完全な文字列化は発生しない
  And 返り値は content 文字列のみ

Scenario: 診断情報が必要なときだけバイト数を計算する
  Given returnInfo=true で extractMainContent を呼ぶ
  When ExtractResult を受け取る
  Then pageBytes / candidateBytes / originalBytes / cleansedBytes が正しい UTF-8 バイト数で埋まる
  And その値は従来実装と一致する

Scenario: バイト数計算は各段階で 1 回だけ
  Given returnInfo=true
  When 抽出が完了する
  Then 同一文字列に対する getByteSize 呼び出しは重複しない（段階ごとにキャッシュ or 単回）
```

## 受け入れ基準
- [x] `returnInfo=false` の経路でバイト計測（`getByteSize` / `Blob` サイズ）を一切実行しない
- [x] `returnInfo=true` の経路でのみバイト数を計算。計算結果は従来と一致
- [x] `getByteSize` を「同じ文字列に対して 2 回呼ばれない」構造に（段階ごとに算出した値を変数で持ち回る。既に大半はそうだが `pageBytes` 用の `document.body.textContent` 生成など重複読みを排除）
- [x] `aiSummaryCleaner/index.ts` の `new Blob([outerHTML])` 2 回を、`returnInfo` 相当のフラグがあるときだけ実行。またはバイト数を呼び出し側（`runAiSummaryCleanse`）から `returnInfo` 条件付きで渡す
- [x] `TextEncoder` のインスタンスは使い捨てでなくモジュールスコープで 1 個共有（`const ENCODER = new TextEncoder()`）
- [x] 既存の `contentExtractor` / `aiSummaryCleaner` テスト、診断パネル系テストがすべてパス
- [x] ファネル表示（`funnel: { pageBytes, candidateBytes, cleansedBytes }`）が診断パネルで従来どおり表示される

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/utils/contentExtractor/__tests__/bytesize-lazy.test.ts`（新規）:
  - `TextEncoder.prototype.encode` を spy し、`returnInfo=false` で呼び出し 0 回
  - `returnInfo=true` で `pageBytes` 等が従来の期待値と一致（既存のバイト数アサーションを流用）
  - 同一文字列への `getByteSize` 重複呼び出しがないこと（`encode` 引数を記録して重複検出）
- `aiSummaryCleaner`: `Blob` コンストラクタを spy し、診断フラグ OFF で呼ばれないこと

### 統合テスト
- `pageContentPipeline` 経由で `returnInfo=true` の `ExtractResult` が完全なバイト情報を持つこと
- E2E `dashboard-diagnostics.spec.ts` が回帰しない（ファネル表示）

### ベンチマーク
- 実装前に `npm run bench:micro -- --filter c1` でベースライン取得（fixtures news-article を S/M/L、`returnInfo=false` で wall-clock P50/P95 と heapUsed 差分）→ 実装後に再実行し `bench/reports/` の差分を PR に添付。`returnInfo=false` 経路の P95 が改善（目標: L で -20% 以上）、GC 圧（heapUsed 差分）が低下。`returnInfo=true` 経路は回帰なし（±5% 以内）。

## 見積もり
1.5 pt（呼び出し箇所が多いが機械的。`returnInfo` 分岐は既存）

## 技術的考慮事項
- 依存関係: **PBI 01（ベンチ基盤）に依存**
- `returnInfo` は既に `cleanseOptions` に含まれる。この 1 フラグでバイト計測全体をゲートできる
- `aiSummaryCleaner` は `contentExtractor` の下位モジュール。バイト数を返す責務を持つが、呼び出し側が要否を知っている → オプションで伝播
- フォールバック判定（`_overCleansed` の `_contentBytes / aiSummaryOriginalBytes < fallbackRatio`）はバイト比を使う。**ここは `returnInfo` に関係なく必要** → フォールバック用のバイト計算だけは残し、診断用の `pageBytes` / `candidateBytes` を遅延化する、という切り分けが要る
- 「フォールバック用の最小限バイト計算」と「診断用フル計測」を分離するのが設計の肝

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '36,66p' src/utils/contentExtractor/index.ts
grep -n "getByteSize\|TextEncoder\|new Blob" src/utils/contentExtractor/index.ts src/utils/aiSummaryCleaner/index.ts
```

### 実装方針
1. `const ENCODER = new TextEncoder();` をモジュールスコープに。`getByteSize` は `ENCODER.encode(str).length`
2. `extractMainContent` 内で「フォールバック判定に必要なバイト（`_contentBytes`, `aiSummaryOriginalBytes`）」と「診断専用バイト（`pageBytes`, `candidateBytes`, `originalBytes`, `cleansedBytes`）」を分類
3. 診断専用バイトは `if (returnInfo)` ブロック内でのみ計算。`returnInfo` 時は既に本文を持っているので、その時点の要素から算出
4. `aiSummaryCleaner/index.ts`: `AiSummaryCleanseOptions` に `measureBytes?: boolean` を追加（default false）。`runAiSummaryCleanse` は `returnInfo` のとき true を渡す
5. `pageBytes` 用に `document.body.textContent` を読むのは `returnInfo` 時のみ

### 落とし穴
- フォールバック比率判定を壊すとクレンジング過剰時に生テキストへ戻せなくなる（`content = preAiCleanseText`）→ フォールバック用バイトは必ず残す
- `funnel` が `undefined` になると診断パネルのファネル UI が空になる → `returnInfo=true` では従来どおり埋める
- `candidateBytes` は「candidates[0] の textContent」。`returnInfo` 時に candidates 参照が生きているスコープで計算する必要（現状の構造を確認）

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `npm run bench:micro -- --filter c1` の before/after を PR に添付
- [x] E2E `dashboard-diagnostics.spec.ts` パス
- [x] コードレビュー完了
- [x] CHANGELOG.md に記載（パフォーマンス改善・非機能）
