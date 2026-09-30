# PBI: AI 要約 Cleansing feedback の removal counts 型汚染の修復

## ユーザーストーリー

ユーザーとして、AI 要約 Cleansing feedback 一覧の「Reason」列に意味のある値だけが表示されるようにしたい。なぜなら byte 数や reason 文字列が「削除件数」の地図に混入し、そのまま 1 セルに並んでいるからだ。

## ビジネス価値

- ダッシュボードの Reason 列から、件数として意味を持たない `aiSummaryOriginalBytes:31204` のようなエントリを無くし、表示の信頼性を回復する。
- `Record<string, number>` へ他型の値を `as unknown as` で押し込む型汚染を無くし、同種の混入を再発させない。
- 「件数」と「AI 要約 Cleansing の統計」を別ラベルで描画し、reason 名と bytes を意味のある単位として提示する。
- wire 契約（storage / messaging）を変えず popup 側の合成と描画だけを直すため、既存データの互換性と移行コストをゼロに保つ。
- 同型の過去の型問題（`src/utils/commonTypes.ts:20-24` が記録する union 未拡張問題）と同じく、型で隠せない値を混ぜない方針で型を定義する。

## 優先度

- 種別: fix
- 順位: 8 / 17
- RICEスコア: 6.0（Reach=2 / Impact=3 / Confidence=100% / Effort=1 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: Reason 列に件数と AI 要約統計が混ざらない
  Given 1 件の feedback エントリに cleanseStats の件数と aiSummaryCleansedStats が含まれる
  When ダッシュボードが Reason 列を描画する
  Then 件数だけが「reason:件数」の形式で描画される
  And byte 数や reason 文字列が件数として描画されない
  And AI 要約側の統計は別ラベル付きで表示される

Scenario: 件数側と AI 要約側が両方存在する場合の振り分けが定義されている
  Given cleanseStats と aiSummaryCleansedStats の両方を持つレスポンスがある
  When RemovedCounts を合成する
  Then 両者の情報が失われず、byReason と aiSummary に振り分けられる
  And 同一キーへの上書きで情報が消えない

Scenario: どちらかが欠けている場合も合成できる
  Given cleanseStats のみ、または aiSummaryCleansedStats のみを持つレスポンスがある
  When RemovedCounts を合成する
  Then 存在する側だけが反映され、例外や undefined 参照が発生しない
  And 空のエントリとして安全に扱われる

Scenario: 複数理由（reasons 配列）を扱う
  Given aiSummaryCleansedReasons が複数要素を持つ
  When Reason 列を描画する
  Then 複数理由であることが分かる表示になる
  And 配列が文字列化されて空欄や区切りだけの表示にならない

Scenario: storage と messaging の契約は変わらない
  Given 既存の feedback エントリが wire 形（Record<string, number>）で保存されている
  When 本修正を適用して新しい feedback を保存する
  Then storage のエントリ形は変更されない
  And メッセージングのペイロード型も変更されない
```

## 受け入れ基準

- [x] `RemovedCounts` 型（`{ byReason: Record<string, number>; aiSummary?: { reason: AiSummaryCleansedReason; reasons?: string[]; elements: number; originalBytes: number; cleansedBytes: number } }`）を `src/utils/commonTypes.ts` に定義している。
- [x] `buildRemovedCounts(cleanseStats, aiSummaryCleansedStats)` を純粋関数として実装し、popup の合成と view の描画が同じ型を共有している。
- [x] `src/dashboard/cleansingFeedbackView.ts:62` の `Object.entries(...).map(([k,v]) => ...)` による平坦描画をやめ、`byReason` と `aiSummary` を別ラベルで描画する。
- [x] `aiSummaryCleansedReasons`（string[]）が文字列として無加工に連結されず、理由名として読みやすく描画される。
- [x] 新規ラベルは i18n キーで定義し、`public/_locales/en/messages.json` と `ja` の両方を更新している。既存の「Reason」列見出しとキーは維持する。
- [x] wire 形（`CleansingFeedbackEntry.removedByReason: Record<string, number>`、`src/utils/storage/types.ts:526-533`）を維持し、storage 構造・メッセージ契約・extractor 側の `Map<string, number>`（`src/utils/contentExtractor/types.ts:65`）を変更していない。
- [x] 誤混入エントリが消えることによる表示内容の変化を、意図的な変化として DoD に記録している。
- [x] `npm run validate` が成功し、既存の feedback view / feedbackQueue テストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「Reason 列に件数だけが出て、byte 数や reason 文字列が混ざらない」観測点を確認する。
- 新しいユーザー機能は追加しない。既存エントリの一覧表示と削除操作が変わらないことを Outside-In の観測点とする。
- 既存の（汚染を含む）wire 形エントリを読み込んでも、ページが壊れないことを確認する。

### 統合テスト

- popup の合成経路（`statusPanel` の「報告」ボタンから `enqueueFeedback` まで）が `buildRemovedCounts` を通し、storage に保存されるエントリが既存の wire 形に限られることを確認する。
- `src/utils/aiSummaryCleaner/feedbackQueue.ts:30-45` の `enqueueFeedback` が保存するエントリが `RemovedCounts` ではなく `Record<string, number>` であることを確認する（契約不変）。
- `src/dashboard/cleansingFeedbackView.ts` が `getFeedbackQueue` の結果を受け、`byReason` と `aiSummary` を別ラベルで描画することを確認する。
- `src/dashboard/__tests__/cleansingFeedbackView.test.ts` の既存 pin（`removedByReason: { keyword: 1 }` の fixture）が wire 形のままで有効であることを確認する。

### 単体テスト

- `buildRemovedCounts` を純粋関数として検証する: 件数のみ / AI 統計のみ / 両方 / どちらもなし（空）/ 複数理由配列 の 5 系統。
- `aiSummaryCleansedStats` の各フィールド（`aiSummaryOriginalBytes` / `aiSummaryCleansedBytes` / `aiSummaryCleansedElements` / `aiSummaryCleansedReason` / `aiSummaryCleansedReasons`）が正しい型に振り分けられることを検証する。
- view 側の描画を検証する: 件数が `k:v` 形式で出る、byte 数が件数として出ない、理由名がラベル付きで出る、配列が生の文字列化にならない。
- 既存の view テストが pin する見出し行（Domain / Snippet / Reason / Date / Action）は変更されないことを確認する。

## 実装アプローチ

- **Outside-In**: まず「Reason 列に件数だけが出て、byte 数が混ざらない」という dashboard の外部観測点を failing として書き、green にする。
- **Red-Green-Refactor**: `src/popup/statusPanel.ts:413` の `as unknown as Record<string, number>` による合成を Red として再現し、`buildRemovedCounts` 導入で Green にする。最後に view 側の描画を分離する。
- **型の置き場所**: `RemovedCounts` は `src/utils/commonTypes.ts` に置く。`src/messaging/types.ts` は別 PBI（`2026-09-28-14`）の対象であるため、ファイル重複を避ける。
- **3 つの型の扱い**: extractor 側の `Map<string, number>`（`src/utils/contentExtractor/types.ts:65`）、wire の `Record<string, number>`、popup 内の汚染された `Record<string, number>` のうち、wire 形は維持する。変更するのは popup 内の合成と view の描画のみである。
- **スコープの限定**: `src/utils/contentExtractor/cleansedReason.ts`、`src/utils/contentExtractor/extractionReport.ts`、`src/dashboard/cleansingStatsView.ts` の `removedByReason` 利用は本 PBI の変更対象外とする。

## 見積もり

**1 SP**

1. `RemovedCounts` 型と `buildRemovedCounts` の定義・実装が 0.3 SP（5 系統の純粋関数テストを含む）。2. `statusPanel` の合成経路の置換が 0.2 SP。3. `cleansingFeedbackView` の別ラベル描画と i18n キー（en / ja）が 0.3 SP。4. 既存 view / feedbackQueue テストの期待値確認と更新が 0.2 SP。storage / messaging / extractor 層の変更は含まない。

## 技術的考慮事項

- 型汚染の発生源は `src/popup/statusPanel.ts:407-414` である。`:407` が `removedByReason: Record<string, number> = {}` を宣言し、`:411` で `resp.cleanseStats` を spread し、`:413` で `resp.aiSummaryCleansedStats` を `as unknown as Record<string, number>` として spread している。
- `aiSummaryCleansedStats` の実型は `src/messaging/types.ts:50-56` にあり、`aiSummaryOriginalBytes: number`、`aiSummaryCleansedBytes: number`、`aiSummaryCleansedElements: number`、`aiSummaryCleansedReason: AiSummaryCleansedReason`、`aiSummaryCleansedReasons?: string[]` である。number 地図に string union と string[] が混入する構造になっている。
- `AiSummaryCleansedReason` は `src/utils/commonTypes.ts:25-33` の string union である。
- 表示経路は `src/dashboard/cleansingFeedbackView.ts:62` であり、`Object.entries(e.removedByReason).map(([k,v]) => `${k}:${v}`).join(', ')` でそのまま描画する。ユーザーは `aiSummaryOriginalBytes:31204, aiSummaryCleansedReason:multiple` などを 1 セルに並ぶことを確認する。
- 同型の過去修復として、`src/utils/commonTypes.ts:20-24` のコメントが「union 未拡張により cast 書き込みが生じた」経緯を記録している。本 PBI は「値を混ぜない」ことで同種の混入を排除する。
- wire 形 `CleansingFeedbackEntry.removedByReason: Record<string, number>`（`src/utils/storage/types.ts:526-533`）は変更しない。`src/utils/aiSummaryCleaner/feedbackQueue.ts:30-45` の `enqueueFeedback` はこの形のまま保存する。
- extractor 側の `Map<string, number>`（`src/utils/contentExtractor/types.ts:65`）は pipeline 内の集計形であり、本 PBI では変更しない。
- 既存 view テスト（`src/dashboard/__tests__/cleansingFeedbackView.test.ts`）は header 行（Domain / Snippet / Reason / Date / Action）の pin であり、row の Reason セルの描画内容は pin されていない。fixture の `removedByReason: { keyword: 1 }`（`:44`）は wire 形のままで有効である。
- i18n について、ユーザー向けテキストは `getMessageOr` 経由とする（`src/dashboard/cleansingFeedbackView.ts:47` が既存の見出しで使用している）。新規ラベルの追加は `public/_locales/en/messages.json` と `ja` の両方に行う。
- 影響として、Reason 列の表示内容が変わる（誤混入エントリが消える）ことを意図的な変化として扱う。storage 構造と messaging 契約は不変である。

## 実装者向け注記

### 現状コードの確認

- `src/popup/statusPanel.ts:407` が `let removedByReason: Record<string, number> = {}` を宣言し、`:411`（`cleanseStats` の spread）と `:413`（`aiSummaryCleansedStats` の `as unknown as` spread）で合成している。`:420` の `enqueueFeedback({ ..., removedByReason })` へ渡される。
- `src/messaging/types.ts:50-56` に `aiSummaryCleansedStats` の実型が宣言されている。number 3 個 + string union 1 個 + string[] 1 個である。
- `src/dashboard/cleansingFeedbackView.ts:62` が Reason セルの描画である。`Object.entries` の順序は保存順であり、安定した並びではない。
- `src/utils/storage/types.ts:526-533` の `CleansingFeedbackEntry.removedByReason: Record<string, number>` は wire 契約であり、維持する。
- `src/utils/aiSummaryCleaner/feedbackQueue.ts:37` が `removedByReason: entry.removedByReason` をそのまま保存している。保存時の変換はない。
- `src/dashboard/__tests__/cleansingFeedbackView.test.ts:44` の fixture は `removedByReason: { keyword: 1 }` であり、wire 形の pin として有効である。

### 実装手順

1. `src/dashboard/__tests__/cleansingFeedbackView.test.ts` に「Reason セルの描画内容」の Red を追加する。byte 数が件数として出る状態を再現する。
2. `src/utils/commonTypes.ts` に `RemovedCounts` 型を定義する。`aiSummary` 部分は `reason`（`AiSummaryCleansedReason`）、`reasons`（`string[]`）、`elements`、`originalBytes`、`cleansedBytes` を持つ。
3. `buildRemovedCounts(cleanseStats, aiSummaryCleansedStats)` を純粋関数として実装する。両者が欠けるケースを安全に扱う。
4. 5 系統（件数のみ / AI 統計のみ / 両方 / どちらもなし / 複数理由）の単体テストを green にする。
5. `src/popup/statusPanel.ts:407-414` を `buildRemovedCounts` 呼び出しへ置き換える。`as unknown as Record<string, number>` を削除する。`enqueueFeedback` へ渡す値は既存 wire 形の `byReason` のみとする。
6. `src/dashboard/cleansingFeedbackView.ts:62` の描画を、byReason の `k:v` 連結と aiSummary のラベル付き描画（bytes / elements / reason / reasons）に分ける。
7. 新規ラベルを i18n キーで定義し、`public/_locales/en/messages.json` と `ja` の両方を更新する。既存の「Reason」見出しキーは維持する。
8. 既存の view テスト（header pin）と feedbackQueue テストが変更なしで通ることを確認する。row 描画の期待値を追加・更新する。
9. `npm run validate` を実行して型とテストを確認する。

### 落とし穴

- `RemovedCounts` を `src/messaging/types.ts` に置くと、同一ファイルを扱う PBI（`2026-09-28-14`）と重複する。`src/utils/commonTypes.ts` に置く。
- 統合順序（`cleanseStats` を先に、aiSummary で後に上書き）を決めないと、同一キーがある場合に情報が消える。byReason と aiSummary を別フィールドに振り分ける。
- `aiSummaryCleansedReasons`（string[]）をそのまま文字列連結すると、区切りだけの表示や空欄になる。配列は要素ごとに明示的に描画する。
- wire 形（`Record<string, number>`）を変更すると、保存済みエントリ（汚染を含む）と新規エントリの互換性が壊れる。wire 形は維持し、汚染の混入を新規保存の時点で止める（既存 storage の移行は行わない）。
- 既存エントリの表示が壊れて見えることで、既存 view テストの期待値を安易に書き換えてしまう。見出し pin（header）は変更対象ではない。
- 既存（汚染された）エントリに遭遇したとき、view 側で「number 以外を落とす」sanitize を入れると wire 契約への関心が混在する。サニタイズは builder 側（popup 合成）に置き、view は構造化された型だけを描く。
- 複数理由が `aiSummaryCleansedReason` 単一値だけでなく `aiSummaryCleansedReasons` 配列も持つ構造である。単一値だけを描画すると詳細が失われる。両方を描画する。
- i18n キーを片方の言語だけで追加すると、表示が fallback 英語になる。en / ja の両方を更新する。

## 決定事項

1. 型汚染が発生した理由は、`src/popup/statusPanel.ts:411` で `cleanseStats`（件数）と `:413` で `aiSummaryCleansedStats`（bytes / reason / reasons）を、同じ `Record<string, number>` 型に `as unknown as` で強制した点にある。
2. `as unknown as` が使われた理由は、2 つのレスポンスフィールドの形が異なり（件数のみ / 混在）、合成先の型を `Record<string, number>` 1 つに固定していたためである。
3. 今是正する必要が立っている理由は、ユーザーがダッシュボードの Reason 列で「件数ではない値」を件数として読むという観測可能な実害があるためである。
4. `RemovedCounts` 型は `src/utils/commonTypes.ts` に置く。`src/messaging/types.ts` は PBI `2026-09-28-14` の領域であり、ファイル重複を避ける。
5. `buildRemovedCounts(cleanseStats, aiSummaryCleansedStats)` を popup の合成と view の描画が共有する builder とする。
6. wire 形（`CleansingFeedbackEntry.removedByReason: Record<string, number>`、`src/utils/storage/types.ts:526-533`）は維持する。storage 構造・メッセージ契約・extractor の `Map<string, number>` は変更しない。変更するのは popup 側の合成と view の描画のみである。
7. `cleansingFeedbackView` は byReason と aiSummary を別ラベルで描画し、byte 数を件数として表示しない。
8. 誤混入エントリが消えることによる表示変化は意図的な変化として扱い、DoD に記録する。既存 storage の移行は行わない。
9. 既存 view テストの header pin（Domain / Snippet / Reason / Date / Action）は変更せず、row の Reason セル描画の pin を追加・更新する。

## Definition of Done

- [x] `RemovedCounts` 型と `buildRemovedCounts` が `src/utils/commonTypes.ts` に定義・実装されている。
- [x] `src/popup/statusPanel.ts:407-414` の `as unknown as Record<string, number>` による合成が排除されている。
- [x] `src/dashboard/cleansingFeedbackView.ts:62` の平坦描画が、byReason と aiSummary の別ラベル描画へ変更されている。
- [x] byte 数が件数として Reason 列に表示されないことをテストで確認している。
- [x] 新規 i18n キーが `public/_locales/en/messages.json` と `ja` の両方に追加されている。
- [x] wire 形（`src/utils/storage/types.ts:526-533`）、storage 構造、messaging 契約、extractor の `Map<string, number>` が変更されていない。
- [x] Reason 列の表示内容が変わる（誤混入エントリが消える）ことを意図的な変化として記録している。
- [x] `npm run validate` が成功し、既存の feedbackQueue テストに回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [x] コードレビューが完了している。
