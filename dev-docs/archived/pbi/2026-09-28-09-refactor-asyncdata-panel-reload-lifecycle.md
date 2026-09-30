# PBI: asyncData パネルの reload ライフサイクルの共通部品化

## ユーザーストーリー

保守者として、analysis パネル群の reload ライフサイクルを共通部品に寄せたい。なぜなら 9 パネルが同一骨格（loadSeq の加算 → クリア → notices.reset → fetch → seq 比較 → empty 表示 → catch で seq 比較と showError）を手書きしており、期間フォールバックがすでに 2 系統に drift しているからだ。

## ビジネス価値

- 9 箇所に散らばった逐語重複骨格を 1 本に集約し、seq 管理の漏れと取りこぼし（destroy 後の描画、空期間表示の欠落）の再発を、1 箇所で直せる単位にする。
- 期間フォールバックの 2 系統 drift（無制限 `{}` と宣言プリセット一致）を 1 系統へ是正する。現状は `timeHeatmapPanel` が 'last90' を宣言しながら実フォールバックは全期間となり、filter host 欠損時に静かに全期間化する。
- 共通部品の「外周」（host 取得 → filter mount → reload → destroy）だけを抽象化し、データ取得集約済みの `fetchPeriodRows` と描画本体には手を入れないため、差分の観測面を限定できる。
- PBI `2026-09-28-11`（local date SSOT）と共有する `tagClusterTimeSliderPanel.ts` を先に片付けることで、ローカル日付 utilities 統合時の競合領域を 1 ファイルに閉じる。

## 優先度（refactor / 順位 9 / 17 / RICEスコア 5.4（Reach=6 / Impact=2 / Confidence=90% / Effort=2 SP））

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: 9 パネルの reload が共通部品経由でも従来と同じ結果を生む
  Given asyncData 配下の 9 パネルが filter host と empty/error surface を持つ形で組まれている
  And 各パネルは period 選択・手動 reload・destroy を含む一連の導線を持つ
  When 共通部品へ移行した状態でパネルを開き period を切り替える
  Then 各パネルの結果は移行前と同じ行集合・同じ empty 表示・同じ truncated 表示になる
  And destroy 後に解決した fetch は画面へ反映されない
  And ユーザーに観測される reload の順序と表示の遷移は変わらない

Scenario: filter host が欠損した場合のフォールバックが各パネルの宣言プリセットへ統一される
  Given timeHeatmapPanel が 'last90' を初期プリセットとして宣言している
  And tagClusterPanel と wordClusterPanel が 'last7' を初期プリセットとして宣言している
  When パネルが filter handle を解決できない状態で reload する
  Then query 境界は宣言プリセットの範囲になり、無制限範囲にならない
  And 無制限フォールバックを前提とするコードが残らない

Scenario: ロード失敗時のエラー表示が最新 loadSeq の loads でのみ更新される
  Given 2 つの load が同時に進行中で、先行した load が後から失敗する
  When 先行 load の fetch が reject する
  Then エラー表示は現行 load によって上書きされた状態を保持し、古い load の失敗で巻き戻らない
  And notices の empty バインディングは失敗前に reset された状態を保つ

Scenario: 2 日付入力の比較パネルが共通の日付 parse/format 契約を通る
  Given tagClusterTimeSliderPanel に開始日と終了日の date 入力がある
  When 終了日が開始日より前の値で apply される
  Then 入力値が補正され、補正済み通知が出て、補正後の窓で比較が実行される
  And 同一日の窓や不正入力では window 空の検証メッセージが出て fetch されない
```

## 受け入れ基準（4-8件）

- [x] `createAsyncDataPanelLifecycle` 相当の共通部品を 1 本新設し、host 取得・`createPeriodFilter` の mount・`reload`（seq 管理）・`destroy`（seq の加算と notices クリア）の 4 責務だけを持ち、他責務を引き受けない。
- [x] 対象 9 パネル（`tagClusterPanel` / `wordClusterPanel` / `timeHeatmapPanel` / `domainAnalysisPanel` / `researchSessionsPanel` / `tagFrequencyTimelinePanel` / `tagCooccurrenceTablePanel` / `revisitInsightsPanel` / `tagClusterTimeSliderPanel`）の reload 骨格が共通部品経由になり、手書きの逐語コピーが残っていない。
- [x] `createPeriodFilter` の mount 6 行の重複 7 箇所（`tagClusterPanel.ts:216-231`、`wordClusterPanel.ts:278-288`、`timeHeatmapPanel.ts:133-146`、`domainAnalysisPanel.ts:225-231`、`researchSessionsPanel.ts:358-369`、`tagFrequencyTimelinePanel.ts:450-456`、`tagCooccurrenceTablePanel.ts:283-289`）が共通部品の mount に集約されている。
- [x] 期間フォールバックが各パネルの宣言プリセット（`presetToRange`）に統一され、無制限 `{}` 系統（`tagClusterPanel.ts:65`、`wordClusterPanel.ts:86`、`timeHeatmapPanel.ts:83`、`tagCooccurrenceTablePanel.ts:217`）が解消されている。唯一の意図的挙動変化として、filter host 欠損時に全期間へ落ちるパネルの既存テストの期待を宣言プリセットへ更新し、変更理由をテストコメントに記している。
- [x] 共通部品は notices の種類差（empty / showError キー）と destroy 差（panZoom cleanup の有無、`firstNotices` / `secondNotices` の 2 分割）をパネル側 callback で吸収し、部品側に特定パネル名の分岐を持ち越していない。
- [x] `tagClusterTimeSliderPanel` の 2 日付入力ウィンドウ（`tagClusterTimeSliderPanel.ts:361-420`）が `customRangeToBounds` / `parseDateInput` へ寄せられ、補正通知と空 window 検証という既存の UX 挙動が保存されている。
- [x] 描画本体（`renderTagGraph` 相当、SVG 組立、cooccurrence 計算）は変更せず、`entrypoints/options/index.html:1775/1951/1961/2043/2072/2093/2111` の host div id も変更していない。
- [x] `npm run validate` が成功し、既存のビルド・テスト・ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- analysis パネルを開き、period プリセット切替・手動 reload・タブ離脱（destroy）を順に操作し、表示結果が変わらないことを Outside-In の観測点とする。共通部品導入という内部構造は観測点にしない。
- 意図的変化の 1 点を明示的に観測する: filter host を意図的に外した状態でパネルを reload し、`timeHeatmapPanel` が全期間ではなく 'last90' 範囲になることを確認する。
- 新規のユーザー機能は追加しない。

### 統合テスト

- 共通部品と各パネル factory の結合を検証する: host が実在する / 欠損する、filter handle が null を返す、fetch が reject する、destroy 後に fetch が解決する、の 4 系統。
- 既存のパネル単体テストが `fetchPeriodRows` を直接 mock している場合、lifecycle 経由の呼び出しに合わせて更新する（mock 対象のパス自体は維持する）。
- `notices.reset()` → fetch → empty バインディング設定の順序が、共通部品経由で変わらないことをアサートする。

### 単体テスト

- 共通部品単体を fake host と fake filter handle で検証する: `reload` が seq を加算する / 同一 reload 中の 2 連呼び出しで古い方が破棄される / `destroy` 後の load が反映されない / `destroy` が seq を加算し notices をクリアする。
- 9 パネルの宣言プリセットが `createPeriodFilter` の `initialPreset` と `presetToRange` のフォールバックで一致することを表形式で pin する。
- 実時間待ち sleep / `setTimeout` による待機をテストに導入しない。待機が必要な箇所は完了条件の promise か `waitForMock` で代用する。

## 実装アプローチ

- **Outside-In**: 先に 9 パネルの現行 reload 挙動（成功・空期間・失敗・destroy 後 race の 4 系統）を観測するテストを green の基準として置き、その上で共通部品へ置換する。
- **Red-Green-Refactor**: 期間フォールバック統一を Red（無制限 `{}` を返すテスト）として書き、宣言プリセット一致で Green にする。骨格の共通部品化は挙動を固定した Green 状態の上で行う refactor とする。
- **抽象化の境界**: 共通部品に含めるのは host 取得・filter mount・`reload` の seq 管理・`destroy` の 4 責務のみ。fetch 結果から描画への変換、notices キー文字列、truncated 表示の文言は callback 引数で受け、部品内に残さない。
- **YAGNI 遵守**: 9 copy 未満の骨格には本部品を適用しない。`sqliteHistoryPanelView` 系の別系統パネル、`fetchPeriodRows` 内部、描画本体（PBI `2026-09-28-17`）は対象外とする。共通部品の汎用オプション（例: リトライ方針、キャッシュ、abort 制御、並列 fetch）は要件として観測された之日起のみ追加し、事前には足さない。
- **shim を作らない**: 旧 reload 実装への互換ラッパーは残さず、9 パネルの編集と同一 commit 内で撤去する。段階移行を許す場合も、各パネルが移行済みか否かをコードで判別できる形（共通部品の import 残存）にする。
- **段階適用**: 3 パネルずつ移行し、各段階で `npm run validate` を通してから次へ進む。host div の id 対応（`entrypoints/options/index.html` 7 箇所）を移行表として先に確定する。

## 見積もり（**2 SP** + 内訳）

- 共通部品の設計と実装（host 解決・mount・seq 管理・destroy・callback 契約）: 0.75 SP
- 9 パネルの段階移行（destroy 差と notices 差の吸収、host id 対応の確認）: 0.75 SP
- 期間フォールバック統一と該当テストの期待更新（意図的変化の明示）: 0.25 SP
- `tagClusterTimeSliderPanel` の 2 日付入力ウィンドウの共通関数への置換: 0.25 SP
- 合計: **2 SP**

## 技術的考慮事項（file:line 付き）

- 逐語重複骨格の 9 箇所: `tagClusterPanel.ts:58-203` / `:236-243`、`wordClusterPanel.ts:66-247` / `:297-310`、`timeHeatmapPanel.ts:67-113` / `:151-159`、`domainAnalysisPanel.ts:123-202` / `:245-259`、`researchSessionsPanel.ts:285-334` / `:389-406`、`tagFrequencyTimelinePanel.ts:372-428` / `:491-506`、`tagCooccurrenceTablePanel.ts:201-263` / `:301-313`、`revisitInsightsPanel.ts:331-378` / `:399-413`、`tagClusterTimeSliderPanel.ts:361-469` / `:532-547`。
- mount 重複 7 箇所: `tagClusterPanel.ts:216-231`、`wordClusterPanel.ts:278-288`、`timeHeatmapPanel.ts:133-146`、`domainAnalysisPanel.ts:225-231`、`researchSessionsPanel.ts:358-369`、`tagFrequencyTimelinePanel.ts:450-456`、`tagCooccurrenceTablePanel.ts:283-289`。
- 期間フォールバック drift（無制限 `{}`）: `tagClusterPanel.ts:65`、`wordClusterPanel.ts:86`、`timeHeatmapPanel.ts:83`、`tagCooccurrenceTablePanel.ts:217`。宣言プリセット一致: `domainAnalysisPanel.ts:130-132`（`presetToRange('last30')`）、`researchSessionsPanel.ts:288`、`tagFrequencyTimelinePanel.ts:388-390`。
- 宣言プリセットの根拠: `tagClusterPanel.ts:5-6` は初期プリセット 'last7' の理由を「user decision 2026-09-24: all-time graphs are too noisy」とコメントに残している。`timeHeatmapPanel` は 'last90' を宣言しながらフォールバックが全期間のため、host 欠損時に表示が静かに全期間化する。
- host div は `entrypoints/options/index.html:1775/1951/1961/2043/2072/2093/2111` に実在する。共通部品は host 欠損を異常とせず、宣言プリセットへフォールバックする（fail-soft）こと。
- `tagClusterTimeSliderPanel` は notices が `firstNotices` / `secondNotices` の 2 分割であり、destroy も 2 本の SVG を持つ。他 8 パネルの 1 分割とは別契約のため、共通部品は notices と destroy を複数インスタンスを受け取れる形にするか、パネル側 callback で各インスタンスを回す形にする。
- `panZoomController?.cleanup()` を含む destroy を持つパネルと持たないパネルの差（`tagClusterPanel.ts:58-203` 付近の cleanup 経路）を吸収する必要がある。cleanup を共通部品の既定値にして Panel 固有の後始末を後始末 callback で足す設計が最小変更になる。
- 2 日付入力の置換対象は `tagClusterTimeSliderPanel.ts:361-420`。`customRangeToBounds` は補正と空 window の判定を 1 箇所に持つが、既存の補正済み通知 UX との対応はパネル側に残す。
- PBI `2026-09-28-11`（local date SSOT）と `tagClusterTimeSliderPanel.ts` を共有するため、本 PBI を先に完了させる。順序を逆にすると同一ファイルへの 2 ラウンド編集が競合する。

## 実装者向け注記

### 現状コードの確認

- `fetchPeriodRows` は `src/dashboard/panels/fetchPeriodRows.ts` に集約済みであり、本 PBI の対象外（「外周」＝ host・filter・reload・destroy のみが対象）。
- 9 パネルすべてが `seq++` → クリア → `notices.reset()` → fetch → seq 比較 → empty → catch で seq 比較 + `showError` の同一順序で reload を書いている。
- 期間フォールバックは 2 系統が実在し、4 パネルの無制限 `{}` と 3 パネルの宣言プリセット一致が併存している。
- `timeHeatmapPanel` は 'last90' を宣言しながらフォールバックが全期間という、内側と外側の不整合が実在する。
- ホスト div は `entrypoints/options/index.html` に 7 箇所実在する（9 パネルに対して 7 個のため、パネルと host の 1:1 対応は開始時に確認が必要）。
- `sqliteHistoryPanelView` などは別系統であり、本 PBI の対象外。

### 実装手順

1. 9 パネル × host div id × 宣言プリセット × notices 構成 × destroy 後始末の対応表を作る。
2. 共通部品の契約（callback: range 取得 / fetch 実行 / render 成功 / render 空 / render エラー、後始末 callback）を決める。seq 加算と破棄の責務を部品側に閉じ込める。
3. 共通部品の単体テスト（4 系統: 正常・空・失敗・destroy 後 race）を先に green にする。
4. 3 パネルずつ移行し、各段階で `npm run validate` を通してから次へ進む。
5. 期間フォールバックを宣言プリセット一致へ切り替え、影響する既存テストの期待を更新する。更新したテストには「意図的挙動変化（host 欠損時のフォールバック統一）」の理由を残す。
6. `tagClusterTimeSliderPanel` の 2 日付入力ウィンドウを `customRangeToBounds` / `parseDateInput` へ置換し、補正通知と空 window 検証の観測挙動が同じであることを確認する。
7. 旧 reload 実装の残存（共通部品を import しないパネル）を検索し、対象 9 パネルがすべて移行済みであることを確認する。
8. 9 パネル分の移行が完了した時点で `npm run validate` を実行し、描画本体と host id が無変更であることを差分で確認する。

### 落とし穴

- 各パネルの destroy が同一ではない。panZoom cleanup を持つものと持たないものを 1 つに固定すると、後始末の漏えいか過大な破棄のどちらかになる。
- notices の種類・キーがパネルごとに違い（empty / showError キー名、truncated 通知の有無）、`tagClusterTimeSliderPanel` は 2 インスタンスである。鍵を部品側で固定すると i18n キーの取り違えが生まれる。
- seq 管理をパネル面へ出すと「seq 比較後に再描画する」タイミングがズレるパネルがある。非同期の狭窄処理（narrowing や layout 計算のあとで描画するパネル）で、`fetch` 後の複数 await を持つパネルが対象になる。
- 既存のパネル単体テストが `fetchPeriodRows` を直接 mock して reload を叩いている場合、共通部品の mount 前に handle が null の状態で動き、期待する空状態表示に到達しない。lifecycle 経由に整合した更新が必要になる。
- 期間フォールバック統一は無制限 `{}` を前提にしたテストを red にする。意図的変化であることを示さないと「テストを壊して通した」変更に見える。
- 共通部品に render 処理・retry 方針・abort 制御を入れ始めると、9 パネルの差異を吸収する器が埋もれて抽象が破綻する。差異は callback で受け、部品は seq 管理とクリアだけを持つ。
- host div とパネルの対応を取り違えると、host が見つからないパネルが「例外を投げない無描画」になる。fail-soft にした場合は host 欠損のログまたは検証を 1 箇所で可視化する。
- `tagClusterTimeSliderPanel.ts` は PBI `2026-09-28-11` とも共有するため、完了時に引き渡し可能な形の差分にしておく。

## 決定事項

1. 共通部品の責務は host 取得・filter mount・`reload`（seq 管理）・`destroy`（seq の加算と notices クリア）の 4 つに限定する。`fetchPeriodRows` と描画本体は対象外とする。
2. 期間フォールバックは各パネルの宣言プリセット（`presetToRange`）に統一する。これは唯一の意図的な観測挙動変化であり、DoD とテストの理由コメントに明記する。
3. `timeHeatmapPanel` の 'last90' 宣言と全期間フォールバックの不整合は、バグとして是正対象とする（無制限化は許容しない）。
4. 9 copy 未満の骨格には共通部品を適用しない。別系統パネル（`sqliteHistoryPanelView` 等）は対象外とする。
5. `tagClusterTimeSliderPanel` の 2 日付入力ウィンドウは `customRangeToBounds` / `parseDateInput` へ置換するが、補正済み通知と空 window 検証の UX は保持する。
6. notices の鍵と destroy の追加後始末は callback で吸収し、部品内にパネル固有の分岐を持ち越さない。
7. 旧実装への互換 shim は残さず、移行と撤去を同じ PBI 内で完了させる。
8. 本 PBI を PBI `2026-09-28-11` より先に完了させ、`tagClusterTimeSliderPanel.ts` の編集を 1 ラウンドに閉じる。

## Definition of Done

- [x] 共通部品が host 取得・mount・`reload`（seq 管理）・`destroy` の 4 責務を持ち、9 パネルの reload 骨格と mount 7 箇所の重複が解消されている。
- [x] 期間フォールバックが宣言プリセットに統一され、`timeHeatmapPanel` の 'last90' 宣言とフォールバックの不整合が解消されている。無制限 `{}` 系統を前提にした既存テストの期待が更新され、理由がコメントで明示されている。
- [x] 意図的変化（filter host 欠損時のフォールバック）を例外として、reload の観測挙動が不変である: 表示結果・empty/truncated/error 表示・reload 順序・destroy 後の非反映がすべて移行前と一致する。
- [x] `tagClusterTimeSliderPanel` の 2 日付入力が共通の日付 parse/format 関数を通り、補正通知・空 window 検証の挙動が保存されている。
- [x] 共通部品にパネル固有の分岐・retry 方針・abort 制御・描画ロジックを持ち込まず、YAGNI 遵守が保たれている。
- [x] 共通部品の単体テスト（正常・空・失敗・destroy 後 race）と 9 パネルの既存パネルテストが green である。
- [x] 既存のパネル単体テストが `fetchPeriodRows` の mock 経由で lifecycle 経由の呼び出しに合わせて更新され、期待値がズレず整合している。
- [x] 描画本体、`fetchPeriodRows`、`entrypoints/options/index.html` の host div id が変更されていない。
- [x] `npm run validate` が成功し、既存ビルド・テスト・ユーザー観測挙動に回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
