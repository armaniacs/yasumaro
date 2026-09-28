# PBI: Cleansing feedback の AI 要約統計の欠落の修復

## ユーザーストーリー

ユーザーとして、送信済みの Cleansing feedback を後から閲覧したときに、AI 要約クレンジングの統計（要素数・元バイト・清洗後バイト・理由）が保存されているようにしたい。なぜなら PBI 2026-09-28-08 で型汚染を分離した結果、AI 統計がエントリから落ち、件数だけが残るようになったからだ。

## ビジネス価値

- 送信済みレポートの情報価値が失われる回数をなくす。ユーザーは「何を報告したか」だけを見て、AI 要約がどれだけ削減できたかを確認できない。
- PBI 2026-09-28-08 が「件数と AI 統計を混ぜない」ために作った型分離を、保存・読み戻しの両端まで貫く。`readRemovedCounts`（保存済み wire レコードの読み戻し変換）が既に用意されているのに、新規エントリがその入力を作っていない。
- 加算的・後方互換の変更で完了するため、既存エントリもメッセージ wire 契約も壊さず、移行作業はゼロ。
- 読み戻し側の描画（`aiSummary` グループの別ラベル描画）が既に存在するため、変更は「値を送るか・描くか」の 2 点に収まる。

## 優先度

- 種別: fix
- 順位: 21 / 23
- RICEスコア: 3.2（Reach=2 / Impact=2 / Confidence=80% / Effort=1 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 新規エントリに AI 要約統計が保存される
  Given popup が GET_CONTENT の応答から AI 要約統計を含む feedback を送信した
  When enqueueFeedback がキューへ保存する
  Then 保存されたエントリに elements / originalBytes / cleansedBytes / reasons が含まれる
  And 既存の保存フィールド（id / url / domain / htmlSnippet / removedByReason / createdAt）は変わらない

Scenario: ダッシュボードで AI 統計が別ラベルとして描画される
  Given 保存済みエントリが aiSummary 統計を持つ
  When Cleansing feedback 一覧を表示する
  Then Reason セルに AI 要約清洗の統計が固有ラベル付きで描画される
  And 件数（byReason）は従来どおり key:count 形式で描画される

Scenario: 旧形式エントリはそのまま読める
  Given 保存済みエントリが aiSummary フィールドを持たない
  When Cleansing feedback 一覧を表示する
  Then エントリは例外なく表示され、AI グループのみ非表示になる
  And 既存の削除・全削除の操作は変わらない

Scenario: メッセージング契約は変更されない
  Given 本修正を適用する前後で popup が保持する統計が同じである
  When feedback を送信する
  Then messaging の ContentResponse 型と wire ペイロードは変更されない
```

## 受け入れ基準

- [ ] `src/utils/storage/types.ts:526-533` の `CleansingFeedbackEntry` に `aiSummary?: AiSummaryRemovedStats`（`src/utils/commonTypes.ts:45-53` の型を再利用）を追加している。
- [ ] `src/utils/aiSummaryCleaner/feedbackQueue.ts:43-57` の `enqueueFeedback` が、入力の `aiSummary` があれば保存エントリへ格納し、なければ省略する（optional 欠落を許す）。
- [ ] `src/popup/statusPanel.ts` が `buildRemovedCounts(...)` の結果から `byReason` だけでなく `aiSummary` も取り、`enqueueFeedback` へ渡す。
- [ ] `src/dashboard/cleansingFeedbackView.ts` の Reason セル描画が、`entry.aiSummary` があれば既存の AI グループ描画を使い、なければ現行の件数のみ描画にフォールバックする。
- [ ] `StorageKeys.CLEANSING_FEEDBACK_QUEUE` のキー名と、キューの 50 件上限・FIFO 退避の挙動を変更していない。
- [ ] messaging の `ContentResponse`（`src/messaging/types.ts:50-56`）を変更していない。
- [ ] 既存 storage の移行処理を追加していない（optional 欠落で旧エントリがそのまま読めるため不要）。
- [ ] `npm run validate` が成功し、既存の feedbackQueue / cleansingFeedbackView / statusPanel テストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「popup から feedback を送信し、そのあとダッシュボードの一覧を開くと AI 統計が見える」という観測点を確認する。
- 既存の送信・一覧表示・削除・全削除の各操作が変わらないことを Outside-In の観測点とする。
- 送信前に保存されていた旧形式エントリが混在していても一覧が壊れないことを確認する。

### 統合テスト

- popup の経路（`statusPanel` の報告ボタンから `enqueueFeedback`、storage 経由、`cleansingFeedbackView` の表示まで）が `buildRemovedCounts` の `aiSummary` を保持したまま storage に到達することを確認する。件数側の `byReason` 保存は不変である。
- `src/utils/aiSummaryCleaner/feedbackQueue.ts:43-57` の保存フィールドに `aiSummary` が条件付きで含まれ、既存フィールドが変わっていないことを確認する。
- `src/dashboard/cleansingFeedbackView.ts` の Reason セルが `entry.aiSummary` を AI グループへ渡すことで描画されることを確認する。
- `src/utils/commonTypes.ts:121-161` の `readRemovedCounts` が保存済み wire レコードを `RemovedCounts` に読み戻す既存挙動が壊れていないことを確認する（既存テスト `src/utils/__tests__/commonTypes.test.ts` の pin）。

### 単体テスト

- `feedbackQueue`: `aiSummary` ありの保存、`aiSummary` なしの保存（フィールド自体が存在しない）、旧形式エントリの読み込み、50 件上限と FIFO 退避が `aiSummary` 付きで も維持されることの 4 系統。
- `cleansingFeedbackView`: `aiSummary` あり（AI グループ描画）/ なし（件数のみ描画）/ 空エントリ の 3 系統。既存の見出し pin（Domain / Snippet / Reason / Date / Action）は変更しない。
- `statusPanel`: `aiSummaryCleansedStats` を持つ応答で `enqueueFeedback` に `aiSummary` が渡ること、持たない応答で渡らないことの 2 系統。件数側の既存 pin（`aiSummary*` キーが `removedByReason` に入らないこと）は維持する。
- `commonTypes`: `buildRemovedCounts` / `readRemovedCounts` の既存テストに変更が無いことを確認する。

## 実装アプローチ

- **Outside-In**: まず「送信後に一覧で AI 統計が見える」という dashboard の外部観測点を failing として書き、green にする。
- **Red-Green-Refactor**: `statusPanel` が `buildRemovedCounts` の `aiSummary` を捨てている状態を Red として再現し、`enqueueFeedback` へ渡すよう拡張して Green にする。最後に view の描画分岐を加える。
- **型の置き場所**: `aiSummary?: AiSummaryRemovedStats` は `CleansingFeedbackEntry`（`src/utils/storage/types.ts:526-533`）に置く。値の型は `src/utils/commonTypes.ts:45-53` の `AiSummaryRemovedStats` を再利用する（新しい型を定義しない）。
- **加算的変更**: optional フィールドの追加のみであり、既存フィールドの型・順序・保存条件は変更しない。旧エントリは optional 欠落でそのまま読める。
- **読み戻し経路の使い分け**: view は `entry.aiSummary` を第一優先とし、それが無い場合のみ既存の `readRemovedCounts(e.removedByReason)` による旧 wire レコードからの復元へフォールバックする。両方が同時に存在するágRMB な場合は optional 側を優先する。
- **スコープの限定**: storage 構造のキー名変更、既存データの移行、messaging 契約の変更は本 PBI の対象外とする。

## 見積もり

**1 SP**

1. `CleansingFeedbackEntry` への optional フィールド追加と `enqueueFeedback` の保存対応（0.2 SP）。2. `statusPanel` からの `aiSummary` 受渡し（0.2 SP）。3. view の描画分岐とフォールバック（0.3 SP）。4. 3 箇所のテスト追加と `npm run validate`（0.3 SP）。i18n キーの追加は不要（既存の AI グループ用キーを使う）。

## 技術的考慮事項

- 保存側の欠落は `src/utils/aiSummaryCleaner/feedbackQueue.ts:43-57` にある。`enqueueFeedback(entry: Omit<CleansingFeedbackEntry, 'id' | 'createdAt'>)` が `newEntry` を組み立てる際、`id` / `url` / `domain` / `htmlSnippet` / `removedByReason` / `createdAt` のみを格納しており、`removedByReason` には AI 統計が入らないため AI 統計も落ちる。
- キューの上限は `MAX_QUEUE_SIZE = 50` で、超過分は `queue.shift()` で古い順に退避する。`aiSummary` の追加でエントリサイズが変わるが、退避の挙動自体は変えない。
- `htmlSnippet` には `MAX_SNIPPET_LENGTH = 500` の切り詰め（`truncateSnippet`）が掛かる。`aiSummary` にも上限を設けるかは、実装時に判断する（`reasons` 配列の要素数と文字列長は `CLEANSING_RULES`（`src/utils/aiSummaryCleaner/rules.ts`、33 エントリ）に由来するため、実運用では数十要素程度に収まる）。
- エントリ型 `CleansingFeedbackEntry`（`src/utils/storage/types.ts:526-533`）は `removedByReason: Record<string, number>` を持つ wire 形である。PBI 2026-09-28-08 が「件数（`Record<string, number>`）を `byReason`、AI 統計（bytes / 理由）を `aiSummary`」に分けた型は `src/utils/commonTypes.ts:64-67` の `RemovedCounts` である。
- 読み戻し側は既に用意されている。`src/utils/commonTypes.ts:121-161` の `readRemovedCounts(removedByReason)` が、保存済み wire レコード（`aiSummary*` キーを number 地図に含む旧形式）から `RemovedCounts` への変換を担当する。view（`src/dashboard/cleansingFeedbackView.ts`）は既に `aiSummary` グループを別ラベルで描画する。08 の反映として描画側は完成しており、本 PBI は「新規エントリがその入力を作る」部分を埋める。
- データフローは `src/popup/statusPanel.ts`（`buildRemovedCounts` 経由で `RemovedCounts` を保持）→ `enqueueFeedback` → storage → `cleansingFeedbackView` である。現状は `statusPanel` が `.byReason` のみを取り出し、AI 統計を捨てている。
- メッセージ wire 契約（`src/messaging/types.ts` の `ContentResponse`）は変更しない。popup が既に `buildRemovedCounts` の結果（`RemovedCounts`）を保持しているため、その `aiSummary` をそのまま `enqueue` に渡すだけでよい。
- 本 PBI は PBI 2026-09-28-08 が意図的に避けた「storage 型変更」を、加算的・後方互換の形で意図的に行う点に注意する。08 の決定（件数と AI 統計を混ぜない、`removedByReason` は件数のみ）は維持する。
- i18n は既存の AI グループ用キー（`historyAiSummaryCleansing`、`historyBytes`、`cleansingCount`、`cleansingFeedbackReason`、`cleansingFeedbackReasons`）を再利用するため、新規 locale 追加は不要である。
- `CleansingFeedbackEntry` は `src/utils/storage/types.ts` にある storage 型であり、wire である。変更は optional フィールドの追加に限られ、既存フィールドの型は変えない。

## 実装者向け注記

### 現状コードの確認

- `src/utils/aiSummaryCleaner/feedbackQueue.ts:43-57` の `enqueueFeedback` が `newEntry: CleansingFeedbackEntry` を組み立てる。`removedByReason: entry.removedByReason` をそのまま格納しており、AI 統計は含まれない。
- `src/utils/storage/types.ts:526-533` の `CleansingFeedbackEntry` は `id` / `url` / `domain` / `htmlSnippet` / `removedByReason` / `createdAt` の 6 フィールドのみ。`aiSummary` は存在しない。
- `src/popup/statusPanel.ts` の報告ボタンのハンドラ内で、`buildRemovedCounts(...)` の結果から `.byReason` を取り出して `removedByReason` に代入し、`enqueueFeedback` に渡している。`.aiSummary` は取り出されていない。
- `src/dashboard/cleansingFeedbackView.ts` の Reason セル描画は `readRemovedCounts(removedByReason)` を使い、`counts.aiSummary` があれば AI グループを描画する。`entry.aiSummary`（新フィールド）は見ていない。
- `src/utils/commonTypes.ts:64-67` の `RemovedCounts` は `byReason` と optional な `aiSummary` を持つ。`src/utils/commonTypes.ts:45-53` の `AiSummaryRemovedStats` は `reason` / `reasons?` / `elements` / `originalBytes` / `cleansedBytes` を持つ。
- 既存テスト `src/utils/aiSummaryCleaner/__tests__/feedbackQueue.test.ts` は enqueue/get の往復、500 字切り詰め、全削除、ID 削除、50 件 FIFO、`StorageKeys.CLEANSING_FEEDBACK_QUEUE` の 6 系統をカバーする。
- 既存テスト `src/dashboard/__tests__/cleansingFeedbackView.test.ts` は Reason セルの描画（件数のみ、AI バイト総数を件数として出さない、AI グループのラベル、複数理由配列）をカバーする。
- 既存テスト `src/popup/__tests__/statusPanel-cleansingFeedback.test.ts` は「保存するのは件数のみで AI バイト総数ではない」ことを pin している。本 PBI はこの pin を壊さず、`aiSummary` は別フィールドで渡す。

### 実装手順

1. `src/utils/aiSummaryCleaner/__tests__/feedbackQueue.test.ts` に「`aiSummary` 付きで保存すると読み戻せる」Red を追加する。
2. `src/utils/storage/types.ts:526-533` の `CleansingFeedbackEntry` に `aiSummary?: AiSummaryRemovedStats` を追加する。型は `src/utils/commonTypes.ts` から type import で再利用する。
3. `src/utils/aiSummaryCleaner/feedbackQueue.ts:43-57` の `enqueueFeedback` で、入力に `aiSummary` があれば `newEntry` に格納する（無ければ省略）。既存フィールドの挙動は変えない。
4. 1-3 の単体テストを Green にする。
5. `src/popup/statusPanel.ts` の報告ハンドラで、`buildRemovedCounts(...)` の結果を変数に保持し、`byReason` と `aiSummary` を `enqueueFeedback` へ渡す。既存の `removedByReason` への代入は `byReason` のままにする。
6. `src/dashboard/cleansingFeedbackView.ts` の Reason セル描画で、`entry.aiSummary` があればそれを AI グループへ渡し、無ければ既存どおり `readRemovedCounts` の結果を使うフォールバックにする。
7. view と statusPanel のテストを追加・更新する（既存の見出し pin と「AI バイト総数が件数として出ない」pin は変更しない）。
8. `npm run validate` を実行して型とテストを確認する。

### 落とし穴

- `aiSummary` を `removedByReason` に入れてしまうと、PBI 2026-09-28-08 が禁じた型汚染が再発する。AI 統計は必ず別フィールドで渡す。既存テスト `statusPanel-cleansingFeedback.test.ts` が「`removedByReason` に `aiSummary*` キーが含まれない」ことを pin している点に注意する。
- `enqueueFeedback` の入力型は `Omit<CleansingFeedbackEntry, 'id' | 'createdAt'>` であり、`CleansingFeedbackEntry` に optional を追加すれば入力型も自動的に optional を受け取る。型を二重に定義しない。
- `aiSummary` を常に `{}` や空値で保存すると、旧形式エントリと区別できなくなる。`undefined` のまま省略し、view 側で「フィールドの有無」で分岐する。
- view で `entry.aiSummary` と `readRemovedCounts` の結果を両方使うと、AI グループが二重に描画される。どちらを優先するかを決定する（optional 側を優先）。
- 旧エントリ（`aiSummary` なし）と新規エントリが混在した一覧の描画を pin するテストを書かないと、AI グループの表示が条件で壊れる。混在ケースの pin を明示的に追加する。
- `reasons` 配列（複数理由）に上限を設けない場合、1 エントリあたりの storage 量が `htmlSnippet` 500 字を超えて増えうる。実装時に `reasons` の要素数と最大長を確認し、必要なら `truncateSnippet` と同型の切り詰めを入れる。
- 50 件 FIFO 退避と新しいフィールドの組み合わせで、古いエントリが新しい形・新しいエントリが古い形になる混在が実際に起きる。退避の挙動自体を変えない。
- `src/messaging/types.ts` の `ContentResponse` を変更すると、PBI 2026-09-28-14（messaging background edge 除去）と同じファイルに手を入れることになる。変更しない。

## 決定事項

1. AI 統計が欠落する理由は、`src/utils/aiSummaryCleaner/feedbackQueue.ts:43-57` の `enqueueFeedback` が `removedByReason` のみを保存し、`buildRemovedCounts` が返す `aiSummary` を渡す経路がなかったことにある。
2. 保存対象の中核である `CleansingFeedbackEntry` に `aiSummary` が入っていなかった理由は、PBI 2026-09-28-08 が「件数と AI 統計の混在」を禁止する意図で `removedByReason` を件数側に限定し、storage 型の変更をスコープ外にしたためである。
3. 今是正する必要が立っている理由は、ユーザーが送信済みレポートの AI  Cleansing 効果を後から確認できないという観測可能な機能欠落があるためである。
4. `CleansingFeedbackEntry` に `aiSummary?: AiSummaryRemovedStats`（`src/utils/commonTypes.ts:45-53` の型を再利用）を optional として追加する。新しい型は定義しない。
5. `enqueueFeedback` の入力型も optional を受け取る（`Omit<CleansingFeedbackEntry, 'id' | 'createdAt'>` の extension として自動的に成立する）。
6. `src/popup/statusPanel.ts` は `buildRemovedCounts` の `RemovedCounts` を保持したまま `aiSummary` を渡し、messaging の `ContentResponse` は変更しない。
7. view は `entry.aiSummary` を優先し、無い場合のみ `readRemovedCounts` の既存経路へフォールバックする。
8. storage キーは変更せず、既存データの移行も行わない。旧エントリは optional 欠落でそのまま動作する。
9. 新規 i18n キーは追加せず、既存の AI グループ用キーを再利用し、`public/_locales/en/messages.json` と `ja` は変更しない。

## Definition of Done

- [ ] `src/utils/storage/types.ts:526-533` の `CleansingFeedbackEntry` に optional な `aiSummary?: AiSummaryRemovedStats` が追加されている。
- [ ] `src/utils/aiSummaryCleaner/feedbackQueue.ts:43-57` の `enqueueFeedback` が `aiSummary` を条件付きで保存し、既存フィールドの保存挙動が変わっていない。
- [ ] `src/popup/statusPanel.ts` が `buildRemovedCounts` の `aiSummary` を `enqueueFeedback` へ渡している。
- [ ] `src/dashboard/cleansingFeedbackView.ts` の Reason セル描画が `entry.aiSummary` あれば AI グループを描画し、無ければ件数のみ描画にフォールバックする。
- [ ] `removedByReason` が件数のみを保持するという PBI 2026-09-28-08 の決定が壊れていない（既存テストの pin が通っている）。
- [ ] messaging の `ContentResponse`（`src/messaging/types.ts:50-56`）と storage のキー名が変更されていない。
- [ ] 旧形式エントリ（`aiSummary` なし）が混在しても一覧が壊れないことをテストで確認している。
- [ ] 50 件 FIFO 退避と 500 字 snippet 切り詰めの挙動が維持されている。
- [ ] `npm run validate` が成功し、既存の feedbackQueue / cleansingFeedbackView / statusPanel テストに回帰がない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
