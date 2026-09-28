# PBI: status メッセージ統一の既知残留 3 件バンドル（stale-timer race / markup utility class 脱落 / popup mainStatus 旧経路）

## ユーザーストーリー

保守者として、status 表示統合の残仕上げを 1 バンドルで閉じたい。なぜなら PBI `2026-09-28-15` で「ステータスを出す」演算の機構は 1 箇所に集まったが、15 が明示的に残課題として記録した 3 つの既知残留が別個のまま残っているからだ。

## ビジネス価値

- 同一要素へ短時間で連続して `showStatus` を呼んだとき、古いタイマーが新しいメッセージを早期 clear する race を構造的に塞ぎ、「エラー表示が勝手に消える」という利用者が信頼できない事象を無くす。
- 全要素書き換え（`el.className = ...`）によって markup が宣言した spacing utility class が最初の 1 描画で消える事象を、CSS 側で解決して markup と CSS の責務分離を保つ。
- popup の `mainStatus` について素 class を直書きする旧経路を 4 箇所撤去し、popup 内でも「class 契約・タイマー管理・既定 duration」が 15 確立の 1 契約に乗る状態にする。
- 15 が単一 class 契約・全要素書き換え方式・`durationMs` / `autoClear` オプションという**決定を変更せずに**残留だけ閉じるため、15 の parity pin（`statusMessageCssContract.test.ts`）を壊さない。
- 3 件は `(a)(b)` と `(c)` でファイルが重複しないため、独立コミット可能な単位として切り分けられる。

## 優先度

- 種別: refactor（サブ項目 (a) のみ fix 性質）
- 順位: 19 / 23
- RICEスコア: 4.05（Reach=3 / Impact=1.5 / Confidence=90% / Effort=1 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 連続表示で古いタイマーが新しいメッセージを早期 clear しない
  Given 同一要素に対して 3000ms の success 表示の直後に 5000ms の error 表示を出す
  And showStatus は setTimeout を発火するだけで、要素ごとに前回タイマーを保持していない
  When 3000ms 経過して最初のタイマーが発火する
  Then 新しい error メッセージは画面上に残り、class は error 契約のままである
  And 5000ms 経過してから初めてメッセージが clear される

Scenario: autoClear=false へ切り替えると直前まで表示されていたタイマーが残留しない
  Given 同一要素に durationMs を指定した表示のスケジュール済み状態がある
  When 続けて autoClear: false で表示する
  Then 前のタイマーは解除され、期限が来ても新しいメッセージが clear されない
  And メッセージは次の描画が置き換えるまで残り続ける

Scenario: markup が宣言した spacing utility class が最初の描画で消えない
  Given dashboard の markup が status 要素に spacing utility class を宣言している
  And showStatus は el.className を全要素書き換えする
  When その要素へ初回 showStatus を呼ぶ
  Then 宣言された余白の意図が保たれている
  And .status-message ベース CSS は margin-top 12px を持つ（15 の DoD で意図的変化とした挙動）

Scenario: popup の mainStatus が単一実装の契約に乗る
  Given popup の mainStatus 要素には class 契約が未定義のままだ
  When mainStatus へ className を直書きする旧経路が 4 箇所に残る状況を点検する
  Then 4 箇所すべてが popup 用 showStatus（durationMs 2000）へ置換されている
  And 素の 'success' / 'error' 直書きが残っていない
  And popup CSS の .success / .error chip の見た目が 15 確立の popup 側契約と同一である
```

## 受け入れ基準

- [x] (a) 同一要素へ短時間で 2 回 `showStatus` を呼んだとき、古いタイマーが新しいメッセージを早期 clear しない。`WeakMap<HTMLElement, ReturnType<typeof setTimeout>>` で要素ごとに前回タイマーを保持し、新規 schedule の直前と `autoClear: false` 遷移時に `clearTimeout` している。
- [x] (a) のテストは実時間待ちを使わず、fake timers / `useTimerClock()` 等の注入可能な手段で race を再現している（`local/no-test-sleep` に違反していない）。
- [x] (b) ダッシュボード markup 内の status 要素に付いている utility class を grep で全数調査し、採用方針（(i) spacing を `.status-message` ベース CSS へ吸収 / (ii) keep-list 方式で既知 utility class を退避・復元）とその理由を記録している。
- [x] (b) の (i) 採用時、margin-top 12px が全 status 要素に付く既存挙動（15 の DoD で意図的変化としたもの）を変えていない。spacing を吸収する場合は「margin-top 12px → 8px」のような既存 pin の置き換えを明示的に列挙している。
- [x] (c) `src/popup/statusPanel.ts:317-350` の `mainStatus` 直書き 4 箇所が popup 用 `showStatus`（`durationMs` 2000）へ置換され、素の `'success'` / `'error'` 直書きが残っていない。
- [x] (c) の 2000ms は PBI 15 が確立した popup 側契約（`src/popup/statusPanel.ts:426`）と同一値であり、既定値へ寄せたり変更したりしていない。
- [x] 既存 pin（`src/utils/ui/__tests__/statusMessageCssContract.test.ts` ほか、class 名・timeout 値を固定している箇所）を維持しつつ、必要な更新だけを反映している。
- [x] 既存ビルド・テスト・ユーザーに観測される動作に回帰がなく、`npm run validate` が成功している。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- dashboard の各 status 要素（spacing utility class を宣言している要素を含む）で表示を観測し、余白が refactor 前 baseline と一致することを確認する。意図的な変化として宣言した項目だけが差分として現れることを確認する。
- success → error の連続表示で、新しく表示した error が古いタイマーの期限で消えないことを E2E 相当の操作シーケンスで確認する。
- popup でドメイン / パスの追加成功・失敗を操作し、mainStatus の chip 見た目と 2000ms の表示時間が baseline と一致することを確認する。
- 新しいユーザー機能は追加せず、「既存 status 表示の観測挙動が不変である（意図列挙のみ意図どおり変化）」ことを Outside-In の観測点とする。

### 統合テスト

- `showStatus` が DOM 要素・タイマー・class 操作のすべてを一元的に行うこと、要素ごとのタイマー状態が DOM から到達できる形（WeakMap など）で保持されていることを確認する。
- (a) と (b) を同一コミット単位、(c) を別コミット単位として実装し、各単位が独立して緑になることを（CI 上の commit 単位の検証で確認する）。
- `src/popup/statusPanel.ts:317-350` の 4 箇所がすべて共通実装を import しており、ローカルに独自の `className` 組み立てや `setTimeout` が残っていないことを確認する。

### 単体テスト

- (a) の race 再現テストを追加する。同一要素へ 3000ms → 5000ms の順に `showStatus` を呼び、3000ms 時点でも新しいメッセージが残ること、5000ms 経過してから clear されることを検証する。タイマーは fake timers / `useTimerClock()` で駆動し、実時間待ちを使わない。
- (a) の `autoClear: false` 遷移テストを追加する。前のタイマーが解除され、期限経過後もメッセージが残ることを検証する。
- (a) の要素分離テストを追加する。別要素のタイマーが本要素の clear に影響しないことを確認する（タイマーを module 変数で共有すると崩れる）。
- (c) の mainStatus 統一 pin を追加する。`statusPanel` の 4 経路が `showStatus` を呼ぶことと、`durationMs: 2000` を指定していることを pin する。
- 既存の `statusMessageCssContract.test.ts`（`.status-message` ベース CSS の box metrics、素 / prefix の success・error 宣言一致、`.show` による animation ゲート）を緑のまま維持する。

## 実装アプローチ

- **Outside-In**: まず (a) の race を Red として再現するテストを追加し、修正前に失敗することを確認する。次に (c) の旧経路 4 箇所を pin する静的チェックを追加し、置換前に失敗することを確認する。
- **Red-Green-Refactor**: (a) を緑にしてから (b) の CSS 方針を決定し、CSS を変更して緑を確認する。最後に (c) を 1 箇所ずつ置換して緑を確認する。
- **(a) の設計**: `WeakMap<HTMLElement, ReturnType<typeof setTimeout>>` を module scope に持ち、`autoClear !== false` で新しいタイマーを schedule する前に前回分を `clearTimeout` し、`autoClear === false` へ遷移するときも同様に `clearTimeout` する。15 の決定（全要素書き換え・単一 class 契約・durationMs / autoClear オプション）は変えない。
- **(b) の設計**: 全要素書き換え方式を維持したまま解決する。(i) spacing を `.status-message` ベース CSS へ吸収する方式を推奨する。CSS 側で完結し、JS 契約（単一 class 契約・全要素書き換え）を複雑化させないためである。採用前に dashboard markup 内の status 要素が持つ utility class を grep で全数調査する。
- **(c) の設計**: popup 用 `showStatus`（`durationMs` 2000）へ統一する。`src/popup/statusPanel.ts:426` で確立された popup 側契約と同一にし、popup CSS の `.success` / `.error` chip を維持する。
- **変更順序**: (a) race 修正 → (b) spacing 方針の決定と CSS 反映 → (c) mainStatus 置換。依存はないため同一 PR でもよいが、独立コミット可能な単位として切り分ける。

## 見積もり

**1 SP**

- (a) stale-timer race の修正と race 再現テスト（fake timers 駆動）: 0.4 SP
- (b) utility class 全数調査・方針決定・CSS 反映と既存 pin の更新: 0.3 SP
- (c) mainStatus 4 箇所の置換と pin の追加: 0.3 SP

いずれも既存実装の局所変更で新しい契約は追加しない。上振れ要因は (b) の全数調査で markup 上の utility class が想定より多い場合と、(b) で margin-top 12px の pin が変わるとして波及する箇所の数。

## 技術的考慮事項

- (a) stale-timer race: `src/utils/ui/settingsUiHelper.ts:59-64` — `showStatus` は `setTimeout` を発火するだけで同要素の前回タイマーを `cancel` しない。同一要素に短時間で 2 回呼ぶと古いタイマーが新しいメッセージを早期 clear する（例: 3s success の直後に 5s error → 3s 後に error が消える）。
- (b) markup utility class の脱落: `src/utils/ui/settingsUiHelper.ts:59-64` の全要素書き換え（`el.className = \`${STATUS_BASE_CLASS} ${type}\``）のため、markup が宣言した `status-message-spaced` / `mt-4` などの spacing class が最初の `showStatus` で消える。pin は `src/utils/ui/__tests__/statusMessageCssContract.test.ts` に済み。
- (b) の採用候補: (i) spacing を `.status-message` ベース CSS へ吸収 / (ii) keep-list 方式（既知 utility class を退避・復元）。(i) を推奨する。
- (b) の注意: margin-top 12px が全 status 要素に付く挙動は 15 の DoD で意図的変化として宣言済みであり、(i) 採用時も変えない。
- (c) popup mainStatus の旧経路: `src/popup/statusPanel.ts:317-350` — `document.getElementById('mainStatus')` → `statusDiv.className = 'success' / 'error'`（素 class・base class なし・タイマー管理なし）が 4 箇所残存。15 の 8 変種対象外だった。
- (c) の popup 側契約: `src/popup/statusPanel.ts:426` の 2000ms（popup 専用契約）を基準値とする。
- 上流 PBI `2026-09-28-15` の決定（`src/utils/ui/settingsUiHelper.ts:59-64` の全要素書き換え方式・単一 class 契約・`durationMs` / `autoClear` オプション）は変更しない。
- ファイル非重複: (a)(b) は `src/utils/ui/settingsUiHelper.ts` + `entrypoints/options/dashboard.css` + そのテスト、(c) は `src/popup/statusPanel.ts` + そのテスト。互いに独立コミット可能な単位として実装する。

## 実装者向け注記

### 現状コードの確認

- `src/utils/ui/settingsUiHelper.ts:59-64` の `showStatus` は、`setTimeout` を発火するだけでタイマー参照をどこにも保持していない。WeakMap は現状存在しない。
- ダッシュボード markup 内の status 要素には spacing utility class（`status-message-spaced` / `mt-4` など）が付いており、全要素書き換えの初回描画で落ちる。
- `src/utils/ui/__tests__/statusMessageCssContract.test.ts` は `.status-message` ベースの box metrics（`margin-top: 12px` / `min-height: 20px`）を pin している。
- `src/popup/statusPanel.ts:317-350` の 4 箇所はいずれも `document.getElementById('mainStatus')` を個別に取得し、素 class を直書きしている。タイマー管理はない。
- `src/popup/statusPanel.ts:426` は `showStatus(statusEl, ..., { durationMs: 2000 })` を呼んでおり、popup 側の基準契約になっている。
- popup の `.success` / `.error` は chip スタイルを持つが、`.status-message` の定義は popup 側には無い。

### 実装手順

1. (a) の race 再現テストを先に追加し、修正前に失敗することを確認する（fake timers / `useTimerClock()` 駆動、実時間待ち禁止）。
2. `src/utils/ui/settingsUiHelper.ts:59-64` に `WeakMap<HTMLElement, ReturnType<typeof setTimeout>>` を導入し、新規 schedule 前と `autoClear === false` 遷移時に `clearTimeout` する。class 契約と options 表面積は 15 の決定どおり変更しない。
3. 要素分離の単体テストを追加し、別要素のタイマーが本要素へ影響しないことを確認する。
4. (a) を緑にしてコミットする（独立単位）。
5. dashboard markup 内の status 要素が持つ utility class を grep で全数調査し、一覧化する。
6. (b) の方針を決める（(i) CSS 吸収を推奨）。決定と理由を記録する。
7. (b) を反映する。margin-top 12px の挙動は変えず、変化する場合は既存 pin の該当箇所と意図的な変化としての一覧を更新する。`statusMessageCssContract.test.ts` を緑に保つ。
8. (b) を緑にしてコミットする（独立単位）。
9. `src/popup/statusPanel.ts:317-350` の 4 箇所を popup 用 `showStatus`（`{ durationMs: 2000 }`）へ 1 箇所ずつ置換する。置換ごとに popup のテストが緑であることを確認する。
10. mainStatus 統一 pin を追加する。
11. (c) を緑にしてコミットする（独立単位）。
12. `npm run validate` が成功することを確認する。

### 落とし穴

- (a) で `clearTimeout` を入れるとき、「`autoClear: false` 呼び出しの後に別要素のタイマー」は別要素なので触れないこと。WeakMap を単一の module 変数にして全要素でタイマー結果を共有すると、別要素の表示が消える。
- (b) の (i) 採用時、margin-top 12px が全 status 要素に付く既存挙動（15 の DoD で意図的変化としたもの）を変えない。`.status-message` の margin を書き換えると `statusMessageCssContract.test.ts` の pin が落ちる。意図的に直す場合は pin を更新したうえで、意図的な変化として記録する。
- (b) で「全要素書き換え」を classList ベースの add / remove へ戻すと、15 の決定（全要素書き換えで clear 時のベースクラス掉落を構造的に防ぐ）を壊す。CSS 側で解決すること。
- (c) で 2000ms を省略すると共通実装の既定値（success 3000 / error 5000）が効き、popup の表示時間が変わる。`durationMs: 2000` を明示する。
- (c) で popup 側へ `.status-message` を書くと、popup CSS にその定義が無いため箱の寸法が当面変わらない。見た目は popup の `.success` / `.error` chip が担い続けることを DoD で確認する。
- (c) の 4 箇所はそれぞれ別のイベントリスナー内にあり、`getElementById` の重複取得も残っている。機械置換すると className 対象を間違えうるため、1 箇所ずつ置換して緑を確認する。
- 既存テストのうち class 名・timeout 値を固定している箇所を更新せずに refactor すると、pin が赤になるだけで原因が追いにくい。先に既存 pin を確認してから変更する。

## 決定事項

1. 本 PBI は PBI `2026-09-28-15` が「既知残留」として記録した 3 件のみを扱い、15 の決定（全要素書き換え方式・単一 class 契約・`durationMs` / `autoClear` オプション）は変更しない。
2. (a) の race 修正は `WeakMap<HTMLElement, ReturnType<typeof setTimeout>>` で要素ごとに前回タイマーを保持し、新規 schedule 前と `autoClear: false` 遷移時に `clearTimeout` する方式とする。タイマーを単一変数で管理しない（要素分離が崩れる）。
3. (a) のテストは実時間待ちを使わず、fake timers / `useTimerClock()` でタイマーを駆動して race を再現する（`local/no-test-sleep` の例外扱いにしない）。
4. (b) は「全要素書き換え方式を維持したまま CSS 側で解決する」方針とし、spacing を `.status-message` ベース CSS へ吸収する (i) を推奨する。keep-list 方式 (ii) は JS 契約を複雑化させるため採用しない。最終判断は markup 上の utility class 全数調査の結果で行う。
5. (b) で margin-top 12px が全 status 要素に付く挙動（15 の DoD で意図的変化としたもの）は変えない。padding へ移す場合も pin 更新と意図列挙を伴う明示的な変化として扱う。
6. (c) の popup mainStatus は popup 用 `showStatus`（`durationMs: 2000`）へ統一し、`src/popup/statusPanel.ts:426` で確立された popup 側契約と同一値を明示指定する。既定値へは寄せない。
7. (c) の chip 見た目は popup CSS の `.success` / `.error` が担い続ける。popup 側へ dashboard の `.status-message` 契約を移植しない。
8. (a)(b) と (c) はファイルが重複しないため、独立コミット可能な単位として実装し、各単位が緑であることを確認してから次へ進む。
9. 既存の pin（`src/utils/ui/__tests__/statusMessageCssContract.test.ts` ほか）は維持し、必要な更新だけを理由付きで反映する。

## Definition of Done

- [x] (a) が修正され、同一要素への連続 `showStatus` で古いタイマーが新しいメッセージを早期 clear しないことを fake timers 駆動のテストで示している。
- [x] `autoClear: false` 遷移時に直前のタイマーが解除され、期限経過後もメッセージが残ることをテストで示している。
- [x] 別要素のタイマーが他要素の表示に影響しないことをテストで示している。
- [x] (b) について、markup 上の utility class の全数調査の結果と採用方針（(i) 推奨）とその理由が記録されている。
- [x] (b) が反映され、`src/utils/ui/__tests__/statusMessageCssContract.test.ts` を含む既存の pin が緑である。margin-top 12px の挙動は意図的に列挙した領域を除いて不変である。
- [x] (c) の `src/popup/statusPanel.ts:317-350` 4 箇所がすべて `showStatus`（`durationMs: 2000`）へ置換され、素 class 直書きが残っていない。
- [x] popup の mainStatus 表示の chip 見た目と 2000ms の表示時間が baseline と一致することを pin / テストで確認している。
- [x] PBI `2026-09-28-15` の決定（全要素書き換え・単一 class 契約・`durationMs` / `autoClear` オプション）が維持されている。
- [x] 意図的な見た目変化（margin / padding の pin 変更分など）が一覧化され、実際の差分と一致している。byte-identical でなくても観測挙動不変でよい。
- [x] `npm run validate` が成功し、既存動作に回帰がなく、コードレビューが完了している。
