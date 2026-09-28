# PBI: initExportScheduler による immediate one-shot alarm の消失の修復

## ユーザーストーリー

ユーザーとして、記録直後に設定保存や接続テストをしても当日の local Markdown export が失われないのを確認したい。なぜなら scheduler の再初期化が arm 済みの one-shot alarm を clear して再作成しないため、当日 buffer が次の記録まで出力されないからである。

## ビジネス価値

- immediate モードの利用者が当日分の Markdown export を取りこぼすという実害を直接防ぐ。
- 接続テストや設定保存という無関係な操作が記録の export を壊すという不安をなくす。
- mode 切替時に無害な余分な flush が走る挙動をテストで明示し、後続の保守者が「不審な発火」として削除することを防ぐ。

## 優先度

- 種別: fix
- 順位: 3 / 17
- RICEスコア: 18.0（Reach=3 / Impact=3 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 記録後に設定保存をしても当日 buffer が失われない
  Given LOCAL_MARKDOWN_EXPORT_TIMING が immediate である
  And 記録によって immediate one-shot alarm が arm されている
  And 当日 buffer に未 flush の内容がある
  When ユーザーが設定保存または接続テストを実行して initExportScheduler が呼ばれる
  Then arm 済みの one-shot alarm は clear されない
  And 当日 buffer は次の flush で出力される

Scenario: idle / daily への mode 切替で旧 alarm の残骸が残らない
  Given LOCAL_MARKDOWN_EXPORT_TIMING が idle である
  When ユーザーが daily へ切り替えて initExportScheduler が呼ばれる
  Then idle の alarm と listener が解除され、daily の alarm が再作成される

Scenario: initExportScheduler 終了時点で clear が完了している
  Given scheduler の clear 呼び出しが非同期である
  When initExportScheduler が完了する
  Then すべての clear が await されている
```

## 受け入れ基準

- [x] `initExportScheduler` が `IMMEDIATE_FLUSH_ALARM` を clear しない（一つ前の one-shot の所有者を `scheduleImmediateFlush` に残す）か、当日 buffer が非空のときだけ再 arm する。
- [x] `src/background/localMarkdownIdleFlusher.ts:44-46` の 3 つの `chrome.alarms.clear` がすべて await されている。
- [x] mode 切替（immediate から daily へ）の直後に旧 one-shot が 1 回発火する挙動が、テストで明示的に pin されている。
- [x] 無害化の根拠（`conflictAction: 'overwrite'`）がコードコメントとして残っている。
- [x] 更新対象テスト `src/background/__tests__/localMarkdownIdleFlusher.test.ts:226-233` が更新されている。
- [x] `src/background/__tests__/localMarkdownIdleFlusher.test.ts:235-242` の alarm clear のみを検証している assert が、listener の解除も含めて確認する形に更新されている。
- [x] `src/dashboard/generalSettings/connectionTests.ts:246`、`:405`、`:492` の無条件 REFRESH_LOCAL_MARKDOWN_SCHEDULER が 変更しないまま、A の修正で無害になっている。
- [x] `npm run validate` が成功し、idle / daily モードの既存挙動に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「immediate モードで記録し、その後設定保存と接続テストを行い、当日 export がちゃんと出力される」という観測点を確認する。
- idle と daily の既存モードの出力タイミングが変わっていないことを確認する。 Outside-In の観測点とする。

### 統合テスト

- `src/dashboard/generalSettings/connectionTests.ts` から `REFRESH_LOCAL_MARKDOWN_SCHEDULER`（`src/background/messageTypes.ts:290`）を経て `src/background/handlers/systemHandlers.ts:242-251` の `initExportScheduler()` に到達する経路を検証する。
- 記録ごとの one-shot arm（`src/background/pipeline/steps/saveLocalMarkdownStep.ts` の `scheduleImmediateFlush`）と scheduler 再初期化の相互作用を、alarm 名前 `yasumaro-local-md-immediate` で追跡する。
- `src/background/alarmRegistry.ts:125-127` が run-only job として登録されていることを反映了 alarm の発火経路を検証する。

### 単体テスト

- `initExportScheduler` が `IMMEDIATE_FLUSH_ALARM` を clear しないことを pin する。
- 3 つの clear が await されている（clear の Promise が解決してから後続 recreate に進む）ことを pin する。
- immediate → daily 切替時に旧 one-shot が 1 回発火しても無害であることを pin する。
- 更新対象テスト `src/background/__tests__/localMarkdownIdleFlusher.test.ts:226-233` の「'immediate' で alarm も listener も登録されない」assert を、現行意図に合わせて書き換える。

## 実装アプローチ

- **Outside-In**: まず「設定保存後も当日 buffer が出力される」という観測点を failing として書き、その Green を alarm 所有者の変更で得る。
- **Red-Green-Refactor**: 現行の「'immediate' で alarm も listener も登録されない」を Red として再現し、IMMEDIATE_FLUSH_ALARM の clear 削除で Green にする。次に clear の await 化を Red-Green で入れる。
- **最小差分の採用**: 案 (a)（immediate を clear しない）を採用し、案 (b)（当日 buffer が非空のとき再 arm）は採用しない。
- **clear の await 化**: 3 つの clear を逐次 await し、完了後に recreate する順序を保証する。
- **挙動変化の明示化**: mode 切替時の余分な flush を pin するテストとコメントで、意図しない副作用ではなく既知の無害化として記録する。

## 見積もり

**0.5 SP**

`initExportScheduler` 1 関数の修正と、alarm mock のテスト更新が主体である。接続テスト側（`src/dashboard/generalSettings/connectionTests.ts`）は変更しない。

## 技術的考慮事項

- `src/background/localMarkdownIdleFlusher.ts:44-46` は `chrome.alarms.clear` を 3 連呼んでいるが未 await である。正規形は `src/background/alarmRegistry.ts:92-99` の await あり実装である。
- `src/background/localMarkdownIdleFlusher.ts:51-63` は `timing === 'idle'` と `'daily'` のときだけ alarm を再作成する。`'immediate'` は再作成されない（`'manual'` と同じ fall-through）。
- fall-through の根拠は `src/background/localMarkdownIdleFlusher.ts:64-65` のコメントで「'immediate' uses the per-recording one-shot alarm created by scheduleImmediateFlush()」と記載されている。
- immediate の one-shot は記録ごとに `src/background/pipeline/steps/saveLocalMarkdownStep.ts` の `scheduleImmediateFlush()` が arm する。alarm 名前は `yasumaro-local-md-immediate` で、`src/background/alarmRegistry.ts:125-127` に run-only job として登録されている。
- トリガー経路は `src/dashboard/generalSettings/connectionTests.ts:246`（保存成功時）、`:405`（AI 接続テスト）、`:492`（Local Markdown テスト）が条件なしで `REFRESH_LOCAL_MARKDOWN_SCHEDULER`（`src/background/messageTypes.ts:290`）を送る。ハンドラは `src/background/handlers/systemHandlers.ts:242-251` で `initExportScheduler()` を呼ぶ。
- 失敗シナリオは immediate 設定で記録 → 1 分以内の one-shot が arm → ユーザーが設定保存またはテスト → `initExportScheduler` が `IMMEDIATE_FLUSH_ALARM` を clear し再作成なし → 当日 buffer は次の記録まで出ない、という一連の流れである。
- 現行挙動を pin するテストは `src/background/__tests__/localMarkdownIdleFlusher.test.ts:226-233` で、'immediate' で alarm も listener も登録されないことを assert している。`:235-242` は alarm clear のみを assert し listener は見ていない。
- 案 (a) と (b) の比較: (a) は `initExportScheduler` が `IMMEDIATE_FLUSH_ALARM` を clear しない方式。one-shot の所有者を `scheduleImmediateFlush` に残す。mode 切替時に 1 回余分に flush が走る副作用は `conflictAction: 'overwrite'` で無害。(b) は `timing === 'immediate'` かつ当日 buffer が非空のときに再 arm する方式。(a) が最小差分で推推。
- `chrome.alarms.create` は同名 alarm を置き換えるため、同一 one-shot 名への再 arm は多重登録にならない。

## 実装者向け注記

### 現状コードの確認

- `src/background/localMarkdownIdleFlusher.ts:43-46` の `initExportScheduler` は 3 つの alarm を clear してから設定を読み、`src/background/localMarkdownIdleFlusher.ts:48-49` で `settingsRepository.getAll()` から timing を取得する。
- `src/background/localMarkdownIdleFlusher.ts:51-63` は 'idle' と 'daily' の分岐のみで、'immediate' と 'manual' は何もしない。'immediate' の説明は `src/background/localMarkdownIdleFlusher.ts:64-65` のコメントにある。
- `scheduleImmediateFlush` は `src/background/localMarkdownIdleFlusher.ts:68-74` 以降にあり、同名 alarm の置き換えにより 1 分に高々 1 ダウンロードという immediate モードの仕様がコメントに書かれている。
- `src/background/alarmRegistry.ts:92-99` は clear を await している正規の実装例である。
- `src/background/alarmRegistry.ts:125-127` は immediate flush を run-only job として登録している。
- `src/background/__tests__/localMarkdownIdleFlusher.test.ts:226-233` は 'immediate' で alarm も listener も登録されないことを assert している。`:235-242` は alarm clear のみを assert している。

### 実装手順

1. 失敗するテスト（または Red 状態の assert）を用意する。immediate one-shot が arm 済みの状態で `initExportScheduler` を呼び、その alarm が残っていることを期待する。
2. `src/background/localMarkdownIdleFlusher.ts:46` の `chrome.alarms.clear(IMMEDIATE_FLUSH_ALARM)` を削除する。
3. `src/background/localMarkdownIdleFlusher.ts:44-46` の 3 つの clear をすべて await する（または Promise.all でまとめる）。
4. 案 (a) を選んだ理由（one-shot の所有者を `scheduleImmediateFlush` に残す）と、mode 切替時に余分な flush が走るが無害である根拠（`conflictAction: 'overwrite'`）をコメントに残す。
5. `src/background/__tests__/localMarkdownIdleFlusher.test.ts:226-233` を更新する。'immediate' で clear されないことを assert する形にする。
6. immediate → daily 切替時に旧 one-shot が 1 回発火する挙動を pin するテストを追加する。
7. `src/background/__tests__/localMarkdownIdleFlusher.test.ts:235-242` を、listener の解除も含めて assert する形に更新する。
8. `npm run validate` を実行して型とテストを確認する。

### 落とし穴

- 案 (a) 採用時は「immediate から daily への切替直後に古い one-shot が 1 回発火する」挙動変化が生じる。無害化の根拠をコメントに残し、テストで明示 pin する。
- `IMMEDIATE_FLUSH_ALARM` の clear を削除しても、mode を manual や idle へ切り替えた直後に one-shot が残る点が検討が必要（1 回だけなら無害）。
- clear の await 化を怠ると、再 create が clear の完了前に走り、mode 切替時に古い alarm が生き残る race が発生する。
- alarm の mock で clear の戻り値を Promise にしないと、await 化のテストが結果として検証できない。
- `scheduleImmediateFlush` の実装を触ると、1 分に高々 1 ダウンロードという immediate モードの仕様を壊す。scheduler 側だけを修正する。

## 決定事項

1. 当日 buffer が失われる理由は、`initExportScheduler` が 3 連 clear で immediate の one-shot まで消す一方で、'immediate' 分岐が存在せず再作成もされないためである。
2. 'immediate' の再作成が存在しない理由は、one-shot を記録ごとの `scheduleImmediateFlush` が所有する設計であり、scheduler は idle と daily の standing alarm だけを所有すると考えられていたためである。
3. その設計が崩れた理由は、clear 対象が standing alarm と one-shot の区別なしにまとめて列挙されていたためである。
4. 今是正する必要が立っている理由は、接続テストと設定保存という無関係な操作で当日の export が失われるという実害が観測可能であるためである。
5. 案 (a) を採用し、`initExportScheduler` は `IMMEDIATE_FLUSH_ALARM` を clear しない。one-shot の所有者は `scheduleImmediateFlush` に残す。
6. 案 (b)（当日 buffer が非空のとき再 arm）は採用しない。状態判定と再 arm のロジックが `initExportScheduler` に増えるだけで、案 (a) と観測結果は同じだからである。
7. 3 つの `chrome.alarms.clear` はすべて await する。`src/background/alarmRegistry.ts:92-99` の正規形へ揃える。
8. immediate から daily へ切り替えた直後に旧 one-shot が 1 回発火する挙動は、`conflictAction: 'overwrite'` により無害であるとして許容し、テストで pin する。
9. `src/dashboard/generalSettings/connectionTests.ts:246`、`:405`、`:492` の無条件 REFRESH は、案 (a) では無害になるため変更しない。

## Definition of Done

- [x] `initExportScheduler` が `IMMEDIATE_FLUSH_ALARM` を clear しないことがテストで pin されている。
- [x] 3 つの `chrome.alarms.clear` がすべて await されている。
- [x] 設定保存・接続テスト後も当日 buffer が失われないことを外部観測で確認している。
- [x] immediate から daily 切替時の余分な flush が pin され、無害化の根拠がコメントに残っている。
- [x] 更新対象テスト `src/background/__tests__/localMarkdownIdleFlusher.test.ts:226-233` が更新されている。
- [x] `src/background/__tests__/localMarkdownIdleFlusher.test.ts:235-242` が listener の解除も含めて assert する形に更新されている。
- [x] idle / daily モードの既存挙動に回帰がない。
- [x] `npm run validate` が成功している。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [x] コードレビューが完了している。
