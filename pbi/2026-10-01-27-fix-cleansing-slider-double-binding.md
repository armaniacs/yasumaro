# PBI: クレンジングスライダーの二重バインドを解消する（NN11 の残存バグ）

優先度: 27 / 種別: fix
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)
発見: 2026-10-02 Wave 1（NN11）実装後の検証で判明
依存: NN11 の後続（NN11 はコミット済み・本 PBI が残存分を閉じる）

## ユーザーストーリー

Cleansing 設定画面のスライダーを運用するユーザーとして、スライダーを 1 つ動かしたときに他の cleansing 設定が巻き戻る現象が直っていることを期待する、なぜなら 2026-10-02 の NN11 がパネル側の書き込みを delta-write へ変更したが、同じスライダーにもう 1 本の full-form 書き込みが残っており、そちらが先に発火するため修正が実効化していないから。

## 背景（2026-10-02 実測）

`src/dashboard/panels/staticForm/aiSummaryCleansingPanel.ts` が同じ 4 スライダーを 2 回バインドしている。

- `:29` `setupAiSummaryCleansingEventListeners();`（`src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` から import。`:4`）
- `:43-59` パネル自身のループ。`:50-57` が NN11 が追加した delta-write（`settingsRepository.setAll({ [storageKey]: value })`）

そして V2 側 `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:455-480` の `rangeConfigs` ループが 7 スライダーに `change` リスナを貼り、`:475-478` で
`getAiSummaryCleansingSettingsFromUI()` → `saveAiSummaryCleansingSettings(settings)`（フォーム全体の full-form 書き込み）を実行する。

バインド順は panel `:29` が `:43-59` より先なので、1 回の `change` で
1. V2 の full-form 書き込み（先に発火）
2. panel の delta-write（後に発火）
が順に走る。V2 側は生 DOM から全フォームを組み立てるため、マウント後に他経路（別パネル・per-site override・外部書き込み）で変わった兄弟キーは DOM に反映されておらず、full-form 書き込みで古い値に戻る。**これが NN11 が除去したはずの巻き戻しの経路として残っている。**

なお V2 の `rangeConfigs` は 7 件（panel が扱う 4 件 + `ai-summary-cleansing-body-protection-threshold` / `popup-body-protection-threshold` / `ai-summary-cleansing-fallback-min-chars` の 3 件）であり、後者 3 件には delta 経路が存在しない。

## BDD シナリオ

```gherkin
Scenario: 1 スライダーの変更が 1 本の書き込みに収束する
  Given 4 スライダーが panel と V2 の双方に束縛されている
  When そのうち 1 つを change する
  Then ストレージへの書き込みが 1 回だけであり、兄弟キーが巻き戻されない

Scenario: delta 経路を持たない 3 スライダーも保存できる
  Given body-protection / popup-body-protection / fallback-min-chars のスライダー
  When change する
  Then それぞれのキーが delta-write され、値は保存される
```

## 実装宣言

- 挙動維持: ユーザーが変更した値が保存される値と保存されるタイミングは現状と同じ（`change` で即保存）
- V2 の `rangeConfigs` の `change` ハンドラを削除し、7 スライダーすべての delta-write を 1 か所へ集約する。`input` リスナによる表示値のミラーは残す
- 明示的な「保存」ボタンの full-form 書き込み（V2 `:490-509`）はユーザー操作として**維持**する

## 受け入れ基準

- [x] 対象スライダーの `change` が 1 本の delta-write に収束する（二重バインドが解消）
- [x] V2 の `rangeConfigs` 7 件すべてに delta 経路が存在する
- [x] `input` リスナによる表示ミラーと保存ボタンの full-form 書き込みは不変
- [x] 巻き戻し再現テスト（片スライダー変更 + 兄弟キーの並行変更）が通る
- [x] `aiSummaryCleansingSettingsV2` の既存テストが green

## テスト戦略

- テスト戦略

- 対象スライダー 1 件の `change` で delta 経路が 1 回だけ呼ばれることを spy で固定する
- 3 件の delta 未対象スライダーが保存されることを固定する
- 検証: `npx tsc --noEmit` と `src/dashboard/settings/__tests__/` 配下の vitest

## 実装内容

1. V2 の `rangeConfigs` の `change` ハンドラを削除する
2. panel 側（または V2 側）に 7 スライダー分の delta-write を 1 か所へ集約する
3. 二重バインドと巻き戻しの再現テストを追加する

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録（2026-10-02）

### 変更内容

- `aiSummaryCleansingSettingsV2.ts` の閾値テーブル `CLEANSING_THRESHOLD_RANGES`（export 済み）が、全スライダーの delta 書き込みの単一経路になった。各行が自分の 1 個の storage key を持ち、`change` は `settingsRepository.setAll({ [key]: value })` のみを行う
- パネル側 `aiSummaryCleansingPanel.ts` の重複バインドループ、`CleansingThresholdStorageKey` 型、そして使われなくなった `settingsRepository` / `StorageKeys` / `Settings` import を削除。スライダーの `input` ミラーと `change` delta 書き込みは V2 側のテーブルに一本化された
- テーブルを V2 に置いた理由: 全 7 スライダーを列挙しているのは V2 だけであり、2 ファイルに分けると今回のようなバグ（片方だけ更新される）が起きる形状になる

### 追加・変更テスト

- `aiSummaryCleansingPanel.test.ts` は「パネル単体では V2 の setup を経由しない」という前提をやめ、モジュールを実際に mount して V2 側の setup と併走させる形に変更。`vi.mock` による V2 差し替えを撤廃した
- 削除した whole-form 挙動を前提にしていた既存テスト 2 件を、単一キー payload と `calledTimes(1)` を検証するより厳しいアサーションに置き換え、テスト名も変更（`range change event writes only the moved slider key` など）
- mutation 検証: 旧 2 本のバインドを復活させると 16 件中 8 件が落ちる。うち 1 件はマウント時点の古い DOM 値が並行書き込みを上書きする現象を直接観測している

### 検証

`npx tsc --noEmit` / `npm run lint`（error 0）/ `npm test`（999 files, 15367 tests passed）/ `npm run validate` すべて green。

本 PBI の完了により [2026-10-01-11-fix-cleansing-slider-delta-write.md](2026-10-01-11-fix-cleansing-slider-delta-write.md) の受け入れ基準 2（兄弟キーの巻き戻し防止）が端到端で到達できる状態になった。
