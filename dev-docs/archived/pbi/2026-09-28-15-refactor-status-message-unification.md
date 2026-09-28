# PBI: 設定画面の status メッセージ表示の単一実装への統一

## ユーザーストーリー

保守者として、設定画面のステータス表示を 1 実装に統一したい。なぜなら「ステータスを出す」演算に 8 実装があり、class 契約が 2 系統に分裂して CSS と非互換になっているからだ。

## ビジネス価値

- 「ステータスを出す」演算の重複を解消し、状態追加時のコピペ派生を止める。
- class 契約の 2 系統（素の `success`/`error` 系統と `status-message` prefix 系統）の分裂を解消して CSS との整合を 1 系統に寄せる。
- 意図的な見た目変化（margin / font-size / padding / toast アニメーション）を明示的に pin し、refactor と機能変更の境界を確定する。
- 連鎖重複している保存エラー 3 分岐 + 1 亜種を単一箇所へ集約し、エラー表示の文言揺れを防ぐ。
- PBI 1（`2026-09-28-07`）と `settingsPipeline.ts` が重複するため、本 PBI の着手順序を固定する。

## 優先度

- 種別: refactor
- 順位: 15 / 17
- RICEスコア: 3.2（Reach=4 / Impact=1.5 / Confidence=80% / Effort=1.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 全 status 表示が単一実装経由で CSS 定義済みの class 契約に乗る
  Given 素の 'success'/'error' を className に設定する showStatus と、'status-message success'/'status-message error' を設定する変種 7 実装が存在する
  And dashboard.css は .status-message.success / .status-message.error を定義し、素の .success/.error とは別物として扱う
  When 実装範囲の各画面からステータスを表示する
  Then すべてが単一の showStatus 実装を経由して表示される
  And 表示される要素の class が .status-message 系の契約に含まれる

Scenario: className ベースの clear によるスタイル消失が起きない
  Given showStatus は clear 時に el.className = '' を実行する
  And ベースクラス status-message を落とした要素は margin / font-size / padding と toast アニメーションを失う
  When 同一要素で success 表示から error 表示、または clear を連続して行う
  Then ベースクラスが保持され、意図列挙したスタイル変化だけが DoD で宣言されたとおりに現れる
  And toast アニメーションが二重適用されない

Scenario: 保存エラー表示の連鎖重複が単一箇所に集約されている
  Given connectionTests.ts の保存エラー 3 分岐が逐語重複し、settingsPipeline.ts に 4 番目の亜種がある
  When 各分岐の errorId と表示文言を確認する
  Then 同一の errorId と表示文言が 1 箇所の定義から導出されている
  And 4 箇所のうちいずれかが独立に文言を変更できない

Scenario: タイマー duration と自動 clear の有無が呼び出し側から指定できる
  Given 現状 3000ms / 5000ms / 2000ms と、自動 clear あり・なしの組み合わせが混在する
  When 各呼び出し側が duration と clear 方針を指定する
  Then 既存実装の duration と clear の有無が既定値または明示指定として保持される
  And 意図的な変更（自動 clear の有無を変える場合）は DoD に列挙されている
```

## 受け入れ基準

- [x] 「ステータスを出す」演算が単一実装（`src/utils/ui/settingsUiHelper.ts:6-20`）へ統合され、変種 7 実装（`gistSettings.ts:17-22` / `encryptedBackupPanel.ts:31-36` / `aiSummaryCleansingSettingsV2.ts:490-503` / `domainFilterTagUI.ts:210-215` / `cspSettings.ts:233-237` / `models-dev-dialog.ts:502-507` / `popup/statusPanel.ts:426`）が共通実装へ置換されている。
- [x] 実装冒頭で「`.status-message` 系へ寄せるか、素 class 系へ寄せるか」を 1 回決め、CSS とコードのどちらを正としたかを記録し、class 契約の分裂（素の `.success`/`.error` と `.status-message.success`/`.status-message.error`）が解消されている。
- [x] clear 時にベースクラスが落ちる挙動が解消され、margin / font-size / padding と toast アニメーション（`entrypoints/options/dashboard.css:4286-4293`）の消失が防がれ、toast アニメーションが二重適用されないことを確認している。
- [x] タイマー duration（3000ms / 5000ms / 2000ms）と自動 clear の有無がオプションで指定でき、既定値が現状を維持している。
- [x] `popup/statusPanel.ts:426` の 2000ms（popup 専用契約）が維持され、`gistSettings.ts:17-22` と `encryptedBackupPanel.ts:31-36` の自動 clear なし（opt-out）が維持されている。
- [x] `aiSummaryCleansingSettingsV2.ts:490-503` の「エラー時 clear されない」が意図か抜けかを切り分け、結果（維持または修正）を記録している。
- [x] 連鎖重複している保存エラー 3 分岐（`connectionTests.ts:252-267` / `:393-402` / `:481-489`）と 4 番目の亜種（`settingsPipeline.ts:169-176`）が単一箇所へ集約され、意図的な見た目変化が DoD に列挙されている。
- [x] 既存テストのうち class 名・timeout 値を pin している箇所の更新が必要か確認し、既存のビルド、テスト、ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 対象画面（dashboard の各種設定、popup）でステータスを表示し、表示された要素の class・文字色・余白・アニメーションが refactor 前 baseline と一致することを確認する。意図的な変化として宣言した項目だけが差分として現れることを確認する。
- success → error と error → success の連続表示、および clear 後に再度表示する経路で、スタイルが掉落しないことを確認する。
- 自動 clear なしの実装（`gistSettings`・`encryptedBackupPanel`）では、メッセージが残ることが baseline と一致することを確認する。
- popup のステータス（`popup/statusPanel.ts:426`）が 2000ms で消えることが baseline と一致することを確認する。
- 新しいユーザー機能は追加せず、「既存 status 表示の観測挙動が不変である（意図列挙のみ意図どおり変化）」ことを Outside-In の観測点とする。

### 統合テスト

- 統合後の showStatus が DOM 要素・タイマー・class 操作のすべてを一元的に行うことを確認する。
- 各置換箇所が共通実装を import しており、ローカルに独自の class 組み立てや `setTimeout` が残っていないことを確認する。
- `connectionTests.ts` と `settingsPipeline.ts` の保存エラー 4 箇所が同一の errorId / 表示文言定義から導出されていることを確認する。
- PBI 1（`2026-09-28-07`）の完了後に `settingsPipeline.ts` を変更している。

### 単体テスト

- 共通実装の単体テストとして、type ごとの class 設定、clear 時の挙動、duration の既定値と上書き、clear 有無の既定値と opt-out を table-driven に検証する。
- `dashboard.css` の `.status-message.success` / `.status-message.error`（`entrypoints/options/dashboard.css:891`/`:899`/`:905`）と素の `.success`/`.error`（`:917` 以降）が別々の規則として定義されていることを pin する静的チェックを用意する。
- toast アニメーション（`dashboard.css:4286-4293`）が class 変更によって二重適用されないことを確認する。
- 現状、112 箇所の呼び出しの timeout 値と class 契約を pin するテストは存在しないため、pin の新設が要る。

## 実装アプローチ

- **Outside-In**: 実装範囲の各画面について、表示された class・timeout・自動 clear の有無を baseline として記録し、それを Red として parity テストとして固定する。
- **Red-Green-Refactor**: 共通実装を拡張して class 保持と duration / clear オプションを満たし、1 箇所ずつ置換して緑を確認してから次へ進む。
- **class 契約の決定を最初に 1 回だけ行う**: `entrypoints/options/dashboard.css:891`/`:899`/`:905` が `.status-message` 系を定義しているため、prefix 系（`status-message` ベースクラスを持つ）へ寄せるのが自然。素 class 系へ寄せる場合は prefix 系 4 箇所の見た目が変わるため、影響評価を先に行う。
- **clear 方式の変更**: `el.className = ''` ではなく、classList ベースの add / remove（または保持する baseline クラスの明示）にして、ベースクラス掉落を構造的に防ぐ。
- **オプション表面積の最小化**: duration と clear 有無だけをオプションにし、class 構成はデフォルトで 1 系統に固定する。
- **変更順序**: 共通実装の拡張 → class 契約の統一 → 変種 7 実装の置換 → 連鎖重複 4 箇所の集約の順に段階化する。
- **依存順序**: PBI 1（`2026-09-28-07`）が `settingsPipeline.ts` を変更するため、本 PBI はその後に着手する。

## 見積もり

**1.5 SP**

共通実装の拡張（class 保持 + duration / clear オプション）、class 契約の決定と CSS との整合確認、変種 7 実装の置換、保存エラー 4 箇所の集約、意図列挙と parity テストの pin を含む。112 箇所の production 呼び出しのうち、class 名が変わるものは見た目が変わるため、意図列挙とレビューコストが上振れ要因となる。

## 技術的考慮事項

- 正規形は `src/utils/ui/settingsUiHelper.ts:6-20` の `showStatus`。`el.className = type`（素の `'success'` / `'error'`）、clear 時 `className = ''`、timeout 3000 / 5000ms。production 呼び出し 112 箇所。
- 変種 7 実装:
  - `src/dashboard/gistSettings.ts:17-22` — `'status-message success'` / `'status-message error'`、自動 clear なし
  - `src/dashboard/encryptedBackupPanel.ts:31-36` — 同形、自動 clear なし
  - `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:490-503` — 成功 3000ms、エラーは clear されない
  - `src/dashboard/settings/domainFilterTagUI.ts:210-215` — 同形
  - `src/dashboard/cspSettings.ts:233-237` — class なし、`style.display`、3000ms
  - `src/dashboard/models-dev-dialog.ts:502-507` — `classList('hidden')`、5000ms
  - `src/popup/statusPanel.ts:426` — 2000ms
- CSS 非互換の実証: `entrypoints/options/dashboard.css:891`/`:899`/`:905` は `.status-message.success` / `.status-message.error`（ベースクラス必須）を定義し、素の `.success` / `.error`（`:917` 以降）とは別物。
- `showStatus` の `className = ''` による clear はベースクラスも落とすため、prefix 系要素に showStatus を使うと margin / font-size / padding と toast アニメーション（`entrypoints/options/dashboard.css:4286-4293`）が消える。コピペ 4 箇所は全部 prefix 系を選んだまま。
- 連鎖重複: `src/dashboard/generalSettings/connectionTests.ts` の保存エラー 3 分岐が `:252-267` / `:393-402` / `:481-489` に逐語重複し、`src/dashboard/settingsPipeline.ts:169-176` が 4 番目の亜種。
- `src/dashboard/cspSettings.ts:233-237` は class ではなく `style.display` を操作するため、class ベース実装へ置換すると描画経路が変わる。意図的な変化として扱う。
- `src/dashboard/models-dev-dialog.ts:502-507` は `classList('hidden')` を使うため、同様に class ベース実装との整合を確認する。
- `src/popup/statusPanel.ts:426` の 2000ms は popup 専用契約（サイズ都合）として option 化して維持する。
- 依存: `settingsPipeline.ts` は `2026-09-28-07`（fieldValidation descriptor 統合）とファイル重複するため、07 の後に着手する。

## 実装者向け注記

### 現状コードの確認

- 正規形 `showStatus` は `src/utils/ui/settingsUiHelper.ts:6-20`。`el.className = type`、clear 時 `className = ''`、timeout 3000 / 5000ms。production 呼び出し 112 箇所。
- 変種 7 実装は `gistSettings.ts:17-22`、`encryptedBackupPanel.ts:31-36`、`aiSummaryCleansingSettingsV2.ts:490-503`、`domainFilterTagUI.ts:210-215`、`cspSettings.ts:233-237`、`models-dev-dialog.ts:502-507`、`popup/statusPanel.ts:426`。
- `entrypoints/options/dashboard.css:891`/`:899`/`:905` は `.status-message.success` / `.status-message.error` を定義し、`:917` 以降の素の `.success` / `.error` とは別物である。
- toast アニメーションは `entrypoints/options/dashboard.css:4286-4293` にある。
- コピペで派生した prefix 系 4 箇所は、`showStatus` の clear が `className = ''` でベースクラスを落とすため、ベースクラス必須の CSS において clear 後に margin / font-size / padding と toast アニメーションが消える。
- 連鎖重複は `src/dashboard/generalSettings/connectionTests.ts:252-267` / `:393-402` / `:481-489` と `src/dashboard/settingsPipeline.ts:169-176` の 4 箇所。
- 自動 clear がない 2 実装は `gistSettings.ts:17-22` と `encryptedBackupPanel.ts:31-36`。
- `aiSummaryCleansingSettingsV2.ts:490-503` は成功 3000ms・エラーは clear されない。テストがないため grep ベースの現状確認が必要。
- 112 箇所の timeout 値と class 契約を pin するテストは存在しない。

### 実装手順

1. PBI 1（`2026-09-28-07`）の完了を確認する（`settingsPipeline.ts` の重複回避）。
2. 実装範囲の各画面について、表示 class・timeout・自動 clear の有無・描画経路（class / `style.display` / `classList`）を baseline として記録し、parity テストを Red として追加する。
3. class 契約を決める（`.status-message` 系へ寄せるか、素 class 系へ寄せるか）。`entrypoints/options/dashboard.css:891`/`:899`/`:905` が `.status-message` 系を定義しているため、prefix 系へ寄せるのが自然。決定と理由を記録する。
4. 意図的な見た目変化（class 名・margin / font-size / padding・アニメーション・`style.display` 経路からの離脱）を一覧化し、DoD に列挙する。
5. `src/utils/ui/settingsUiHelper.ts:6-20` を拡張する: ベースクラス保持、または classList ベースの add / remove に変更し、clear でベースクラスを落とさない。duration と clear 有無をオプション化する。
6. `src/popup/statusPanel.ts:426` は 2000ms を明示指定する（popup 専用契約の維持）。
7. `src/dashboard/gistSettings.ts:17-22` と `src/dashboard/encryptedBackupPanel.ts:31-36` は自動 clear なしを opt-out で維持する。
8. `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:490-503` の「エラー時 clear されない」が意図か抜けかを切り分ける。意図なら opt-out で維持、抜けなら（意図的な変化として宣言したうえで）修正する。
9. 変種 7 実装を共通実装へ置換する。`cspSettings.ts:233-237`（`style.display`）と `models-dev-dialog.ts:502-507`（`classList('hidden')`）は描画経路が変わるため、個別に parity を確認する。
10. 保存エラー 4 箇所（`connectionTests.ts:252-267` / `:393-402` / `:481-489`、`settingsPipeline.ts:169-176`）を単一の errorId / 表示文言定義へ集約する。
11. parity テストが緑、`npm run validate` が成功することを確認する。
12. 意図列挙と実際の差分が一致することを確認する（宣言してない見た目変化が残っていないこと）。

### 落とし穴

- `className = ''` 系と `classList` 系の混在によって toast アニメーション（`entrypoints/options/dashboard.css:4286-4293`）が二重適用される。clear 方式を 1 系統に揃える。
- `src/utils/ui/settingsUiHelper.ts:6-20` の `className = type` と prefix 系 4 箇所の `'status-message ' + type` は、どちらも「正解に見えて」片方が CSS と非互換。どちらを正とするかを先に決めないと、置換のたびに class 構成が振れて 112 箇所の表示が落ちる。
- `src/dashboard/cspSettings.ts:233-237` は class ではなく `style.display` を操作しているため、class ベース実装へ置換すると描画経路と clear 条件が変わる。意図的な変化として列挙する。
- `src/dashboard/models-dev-dialog.ts:502-507` は `classList('hidden')` を使うため、class ベースの add / remove と hidden の付与タイミングを整合させないと hidden 状態が残る。
- `src/popup/statusPanel.ts:426` の 2000ms は popup 専用契約（サイズ都合）である。共通実装の既定値へ寄せると popup の表示時間を変えてしまう。option 化して明示する。
- `gistSettings.ts:17-22` と `encryptedBackupPanel.ts:31-36` に clear を足すと観測挙動が変わる。opt-out オプションで元の挙動を維持する。
- `aiSummaryCleansingSettingsV2.ts:490-503` の「エラー時 clear されない」はテストがなく意図か抜けか判定できない。grep ベースの現状確認を行い、結果を記録せずに修正しない。
- `settingsPipeline.ts` を PBI 1 と同時に変更すると、統合時に変更意図が衝突する。PBI 1 の完了後に着手する。
- 112 箇所の呼び出しをまとめて機械置換すると、duration 値と clear 有無の読み違いが起きる。1 実装ずつ parity を確認しながら進める。
- 変種 7 実装を消す際、export されている関数や参照が他にないか確認せずに削除すると、import 漏れを検出せずに型チェックが通る。

## 決定事項

1. 「ステータスを出す」演算に 8 実装ある理由は、正規形 `showStatus` が `className = type`（素 class）で、一方で 4 箇所が `'status-message ' + type`（prefix 系）を各自コピペしており、prefix 系が主流の用法として定着しなかったためである。
2. class 契約の分裂は CSS との非互換を生む。`entrypoints/options/dashboard.css:891`/`:899`/`:905` は `.status-message.success` / `.status-message.error`（ベースクラス必須）を定義し、素の `.success` / `.error`（`:917` 以降）とは別物である。
3. `showStatus` の clear が `className = ''` でベースクラスを落とすため、prefix 系要素では margin / font-size / padding と toast アニメーション（`:4286-4293`）が消失する。コピペ 4 箇所は全部 prefix 系を選んだまま残る。
4. 実装は `showStatus` を拡張（ベースクラス保持または classList ベースの add / remove）して 8 実装を 1 本へ統合する。タイマー duration と自動 clear の有無はオプション化する。
5. class 契約の決定は実装冒頭で 1 回だけ行い、記録に残す。`dashboard.css` が `.status-message` 系を正としているため、prefix 系へ寄せるのが自然である。
6. 見た目が変わりうる要素（class 名・margin / font-size / padding・アニメーション・`style.display` 経路）は意図的な変化として DoD に列挙する。
7. 自動 clear がない 2 実装（`gistSettings.ts:17-22`、`encryptedBackupPanel.ts:31-36`）は、clear の追加が観測挙動の変化であるため opt-out オプションで元の挙動を維持する。
8. `aiSummaryCleansingSettingsV2.ts:490-503` の「エラー時 clear されない」はテストがないため、意図か抜けかを実装時に grep で現状確認して切り分ける。
9. 本 PBI は `settingsPipeline.ts` を含むため、`2026-09-28-07`（fieldValidation descriptor 統合）の完了後に着手する。

## Definition of Done

- [x] 「ステータスを出す」演算が `src/utils/ui/settingsUiHelper.ts:6-20` の単一実装へ統合され、変種 7 実装（`gistSettings.ts:17-22`、`encryptedBackupPanel.ts:31-36`、`aiSummaryCleansingSettingsV2.ts:490-503`、`domainFilterTagUI.ts:210-215`、`cspSettings.ts:233-237`、`models-dev-dialog.ts:502-507`、`popup/statusPanel.ts:426`）が共通実装へ置換されている。
- [x] class 契約の分裂（素の `.success`/`.error` と `.status-message.success`/`.status-message.error`）が解消され、決定と理由が記録されている。
- [x] clear 時にベースクラスが落ちない実装になっており、margin / font-size / padding と toast アニメーション（`entrypoints/options/dashboard.css:4286-4293`）の消失が防がれ、二重適用されないことを確認している。
- [x] duration（3000 / 5000 / 2000ms）と自動 clear の有無がオプションで指定でき、既定値が現状を維持している。
- [x] `popup/statusPanel.ts:426` の 2000ms（popup 専用契約）が維持され、`gistSettings.ts:17-22` と `encryptedBackupPanel.ts:31-36` の自動 clear なし（opt-out）が維持されている。
- [x] `aiSummaryCleansingSettingsV2.ts:490-503` の clear 挙動について、意図か抜けかの判定と対応結果が記録されている。
- [x] 保存エラー 4 箇所（`connectionTests.ts:252-267` / `:393-402` / `:481-489`、`settingsPipeline.ts:169-176`）が単一箇所へ集約され、意図的な見た目変化（class 名・余白・フォントサイズ・アニメーション・`style.display` 経路からの離脱）が一覧化され DoD に列挙されている。
- [x] 既存テストのうち class 名・timeout を pin している箇所の更新が必要か確認し、反映している。
- [x] refactor 前後の観測挙動が、DoD に列挙した意図的な変化以外は不変であることを parity テストで示している。byte-identical でなくても観測挙動不変でよい。
- [x] `2026-09-28-07` の完了後に着手しており、`npm run validate` が成功し、既存動作に回帰がなく、コードレビューが完了している。
