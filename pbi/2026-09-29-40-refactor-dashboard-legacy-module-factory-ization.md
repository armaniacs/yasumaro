# PBI: 旧形式ダッシュボードモジュールの factory 化（58 個の module-global 状態の解消）

種別: refactor
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ5）。ダッシュボード旧形式モジュールに module-level の可変状態が集中し、テスト隔離と破棄経路が欠けている。

## ユーザーストーリー

ダッシュボードのパネルを改修する開発者として、面板の状態をテスト間で持ち越されず、明示的に破棄できるモジュールに統一され、要素参照を悬挂えずに再 mount できる状態を目指す。

## 優先度

- 順位: 10 / 10
- RICE スコア: 0.8（Reach=3 / Impact=1 / Confidence=80% / Effort=3.0）
- 根拠: 大規模 refactor でユーザー影響への緊急性は低いが、旧形式の module-global 可変状態が 4 モジュールに集中しており、テスト隔離を阻害し続ける構造問題である。放置すると後続のパネル改修ごとにモック注入（`vi.mock`）が増え、テストの書き方がモジュール実装の詳細に結合する。挙動不変のまま移行できるためリスクは低く、着手理由はコード整理ではなくテスト可能性の回復にある。

## 現状と問題（file:line 証拠付き）

- module-level の可変状態 58 個が旧形式 4 モジュールに集中している
  - `src/dashboard/settings/trustSettings.ts:25-49` — 26 個の DOM 要素参照 + `currentCategory`
  - `src/dashboard/markdownTemplateManager.ts:49-65` — 13 個
  - `src/dashboard/settings/customPromptManager.ts:39-51` — 11 個
  - `src/dashboard/recordingConditionsSettings.ts:15-22` — 8 個
- いずれも `init*()` が `document.getElementById` の戻り値を module global に代入する旧形式である。破棄経路（`destroy()` 等）が存在しないため、同じ document を再利用するテストで状態が持ち越される
- `src/dashboard/panels/staticForm/staticPanels.ts:20-25` は「7 spec が container を無視して `document.getElementById` を使う」ことを自らコメントで自認している
- 新形式の先例が同一ツリーに既に存在し、パターンを写せる
  - `createArchiveSessionStore`（`src/dashboard/panels/diagnostic/archiveSessionStore.ts`）— factory + `destroy()`
  - `PanelNotices`（`src/dashboard/panels/PanelNotices.ts:58-60` instance fields、`clear()` は `:141`）
  - `QueryCache`（`src/dashboard/panels/asyncData/historyQueryCache.ts:14-20`、`clear()` あり）
  - `createAsyncDataPanelLifecycle`（`src/dashboard/panels/asyncData/asyncDataPanelLifecycle.ts:106-107`）— クロージャ + `destroy()`
- 付随する問題
  - `registryContext.ts:4` の module-global `_registry` のため、8 テストファイルが `vi.mock('...registryContext.js')` を強制されている。`:19-21` のコメントは「options/main.ts imports dashboard.ts before main.ts」と説明するが実際は `dashboard/main.js` を import しており陳腐化している（`registryContext.test.ts:13-14` も同様）
  - `issueReportEntry.ts:24,27` の module queue / controller は、`initIssueReportEntry` の二重呼び出しで恒久に未配線のボタンを残す
  - `aiProviderLayoutManager.ts:15` の `originalParents` Map が `HTMLElement` を保持し、破棄経路がない
- 関連台帳: `pbi/2026-09-05-00-backlog-future.md:67`（trustSettings の TagListController 行）。実装時に記録照会する

## 改善方針（方向性）

1. 4 モジュールを factory + instance state + `destroy()` 形式に移行する。新形式パターン（archiveSessionStore / asyncDataPanelLifecycle）を写す。静的フォーム spec からの利用は `staticPanelAdapter` 経由を維持する
2. `registryContext.ts:19-21` の陳腐化したコメントを実際の import 関係に合わせる。DI 化は規模が大きいため、本 PBI では判断記録のみでも可とする
3. `aiProviderLayoutManager` の `HTMLElement` キャッシュに破棄経路を追加する
4. `issueReportEntry` の二重 `init` を防御する

いずれも挙動不変の refactor であり、機能追加・仕様変更を含まない。

## BDD 受け入れシナリオ

```gherkin
Scenario: 二重 init で状態が漏出しない
  Given trustSettings を init する
  When destroy してから再度 init し、設定を読む
  Then 前回 init の状態が残存せず、テスト間で隔離される

Scenario: destroy 後の再 mount が動作する
  Given パネルを destroy する
  When 再度 mount する
  Then 要素参照が再構築され、操作できる

Scenario: 静的フォーム spec の mount 経路が維持される
  Given staticPanels 経由でパネルを mount する
  When 既存 spec と同じ操作を行う
  Then 変更前と同一の結果が得られ、staticPanelAdapter 経由の利用が維持される
```

## 受け入れ基準

- [x] `trustSettings` / `markdownTemplateManager` / `customPromptManager` / `recordingConditionsSettings` の module-level 可変状態がゼロになる（4/4）
- [x] 4 モジュールが instance state を持つ factory として公開され、`destroy()` で全参照を解放する（4/4）
- [x] 静的フォームからの利用が `staticPanelAdapter` 経由のままである
- [x] `registryContext.ts:19-21` のコメントが実際の import 関係と一致する（DI 化の判断が記録されている）
- [x] `aiProviderLayoutManager` の `originalParents` に破棄経路がある
- [x] `initIssueReportEntry` の二重呼び出しで未配線ボタンが残らない
- [x] 公開 API のシグネチャ以外の挙動変更がない（UI・保存内容・メッセージプロトコル不変）

## テスト戦略

- 単体: 各モジュールの factory 化について init / `destroy()` ライフサイクルと二重 init を検証する（新形式の `archiveSessionStore` / `asyncDataPanelLifecycle` のテスト構成に合わせる）
- 統合: `staticPanels` spec 経由の mount 経路は現行テストで維持し、リファクタ後も green であることを確認する
- ゲート: `npm run validate`（type-check + test）

## 見積もり

3.0 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録（2026-09-29・前半：3 モジュール + 付随修正）

### 変更ファイル

| ファイル | 変更 |
|----------|------|
| `src/dashboard/settings/trustSettings.ts` | 22 個の module-level `let` と `currentCategory` を `createTrustSettings()` のクロージャへ移動。`init()` が付けた全リスナを `listen()` が teardown 配列に記録し、`destroy()` が解除する（要素参照・`currentCategory` も同時に破棄）。`TrustSettingsController` / `TrustCategory` / `TrustPermissionSuggestEntry` を export |
| `src/dashboard/settings/customPromptManager.ts` | 10 個の module-level `let` と `currentSettings` を `createCustomPromptManager()` のクロージャへ移動。`destroy()` が save / cancel のリスナを解除し参照を破棄。`CustomPromptManager` を export |
| `src/dashboard/markdownTemplateManager.ts` | 11 個の DOM 参照と `currentSettings` / `editingTemplateId` を `createMarkdownTemplateManager()` のクロージャへ移動。`destroy()` が create / save / cancel / file / entry のリスナを解除。`MarkdownTemplateManager` を export |
| `src/dashboard/aiProviderLayoutManager.ts` | `restoreOriginalProviderSettingsLayout()` の末尾で `originalParents.clear()`。唯一の `HTMLElement` 所有者が破棄経路を持てた |
| `src/dashboard/panels/diagnostic/issueReportEntry.ts` | `initIssueReportEntry()` を冪等化（`if (controller) return;`）。二重 init で controller を作り直し、同じトリガにリスナが二重に残る問題を解消 |
| `src/dashboard/panels/registryContext.ts` | 陳腐化コメントを実際の import 関係に差し替え。`tryGetRegistry()` に production 呼び出し元が無いことも明記 |
| `src/dashboard/panels/__tests__/registryContext.test.ts` | 同じ陳腐化コメント（test 側）を修正 |
| `src/dashboard/__tests__/dashboardLegacyPanelFactories.test.ts` | 新規。3 モジュールの `init` / `destroy` ライフサイクル・インスタンス間独立・destroy 後の再 mount・staticPanelAdapter 経由の mount 経路（9→11 tests） |
| `src/dashboard/__tests__/aiProviderLayoutManager.test.ts` | 「restore 後に記録を捨てる」回帰テストを追加。陳腐化した「restore テストを先に走らせる必要」コメントを撤去 |
| `src/dashboard/__tests__/dashboardIssueReportQueue.test.ts` | 二重 init の冪等性テストを追加 |

### 設計判断

**既定インスタンスを残した理由。** 3 モジュールは `staticPanels` の `StaticPanelSpec` 経由で 1 ページ 1 インスタンスしか作られない。既存の呼び出し元と既存 spec（`trustSettings*.test.ts` 4 本・`customPromptManager*.test.ts` 3 本・`src/popup/__tests__/trustSettings-xss.test.ts`）が module-level 関数を直接呼ぶため、`export function initX()` などは既定インスタンスへの委譲として残す。module-level の可変状態は「`let` 宣言」から「クロージャ内のインスタンス」へ移り、`destroy()` で解放できるようになった。**この 3 ファイルは module-level の `let` がゼロであることを確認済み。**

**`destroy()` の検証方法。** 破棄後のクリックでは「リスナが残っている」ことを観測できない。ハンドラは `dom` / `currentSettings` が null になった時点で早期 return するため、漏れていても無反応になる。そのためテストは `addEventListener` に渡された関数を `removeEventListener` が同じ参照で受け取ったかを突き合わせる形にした（`trackClickListener`）。`trustSettings` だけは `db.addSensitiveDomain()` が instance state に依存しない経路を持つので、クリックの呼出回数でも観測できる。

**`registryContext` の DI 化は本 PBI では行わない（判断記録）。** `_registry` の module global を注入に置き換えるには `main.ts` → `panelFactories` → 全パネルモジュールの生成経路にシグネチャ変更が入り、パネルごとに registry を受け取る形になる。本 PBI は挙動不変の整理であり、`tryGetRegistry()` の production 呼び出し元は無く実害も発生していないため、意図的に据え置いた。8 テストファイルの `vi.mock('.../registryContext.js')` も同じ理由で残す。

**`aiProviderLayoutManager` の clear が無害である理由。** `generalSettingsPanel.refreshAIProviderLayout()` は A→B 切替で `restoreOriginalProviderSettingsLayout()` を呼ぶが、その直後に `providerMount.textContent = ''` でブロックごと破棄し、B→A 切替で `rebuildProviderSettingsMount()` が作り直す。したがって clear 前後の「次に記録される親」はどちらも `providerMount` で観測上変わらない。clear は破棄済み document のノード参照が残り続けるのを防ぐのが主目的。

### 検証

```
npx vitest run src/dashboard/__tests__                                    →  87 files / 1134 tests passed
npx vitest run src/dashboard src/popup/__tests__/trustSettings-xss.test.ts
                    src/utils/storage/__tests__/providerLabelSso.test.ts   → 199 files / 2916 tests passed
npx vitest run <変更 3 ファイル> × 5 回                                    →  28 tests passed / 回（5/5 green）
npx eslint <変更 10 ファイル>                                             →  issues なし
npx tsc --noEmit -p tsconfig.json                                          →  自作ファイルにエラーなし
```

回帰ガード（挙動を戻して新テストが落ちることを確認済み）:

- `aiProviderLayoutManager` の `originalParents.clear()` を削除 → 新テスト 1 件が失敗
- `issueReportEntry` の `if (controller) return;` を削除 → 新テスト 1 件が失敗
- `trustSettings.destroy()` の teardown ループを無効化 → 新テスト 2 件が失敗
- `customPromptManager.destroy()` / `markdownTemplateManager.destroy()` の `removeEventListener` を無効化 → 新テスト各 1 件が失敗

### 未実施・逸脱

- **`providerLabelSso.test.ts` のファイル名一覧は変更なし。** `customPromptManager.ts` のパスは変わらないため追加対応不要。
- **`staticPanels.ts` / `staticPanelAdapter.ts` は無改変。** spec 側の配線は 3 モジュールとも `mount` 関数のままで(factory を直接呼ばない)、factory 化はこの 1 層の下の委譲だけで完結した。
- **`exportImport.ts` の `loadTrustSettings` 参照は無改変で動く。** module-level の委譲関数を残したため。

## 実装記録（2026-09-29・後半：`recordingConditionsSettings`）

### 変更ファイル

| ファイル | 変更 |
|----------|------|
| `src/dashboard/recordingConditionsSettings.ts` | 8 個の module-level `let` を `createRecordingConditionsSettings()` のクロージャへ移動。`dom`（container / saveBtn / validationError / successMsg）と teardown 配列をインスタンスが保持し、`destroy()` が save の click と container の input リスナを解除して参照と値を破棄。`RecordingConditionsSettingsController` を export。module-level の `initRecordingConditionsSettings(repo)` と `destroyRecordingConditionsSettings()` は既定インスタンスへの委譲 |
| `src/dashboard/__tests__/dashboardLegacyPanelFactories.test.ts` | `createRecordingConditionsSettings` のライフサイクル 4 テストを追加（リスナ同一性の照合・二重 init の非スタック・2 インスタンス独立・destroy 後の再 mount）。static-form 経由の mount テストを `panel-recording-conditions` を含めて拡張（11 → 15 tests） |

### 設計判断

**保存ハンドラは `if (!dom) return;` で早期 return する形にした。** 元は `container` と 2 つのメッセージ要素をクロージャに捕まえており、破棄経路が無かったので破棄後も detached なノードへ書き込んでいた。`dom` をインスタンス state に置き換えて null クリアすると、破棄後のノード参照とクリックの副作用が同時に消える。副産物として destroy 後のクリックは無反応になるが、**クリックでは破棄を証明できない**（ハンドラが早期 return するため、リスナが漏れていても観測差が出ない。3 モジュールの記録と同じ制約）。よってテストは `addEventListener` に渡された関数を `removeEventListener` が同じ参照で受け取ったかを突き合わせる形にした。

**save ボタンの登録は要素ローカルの spy では捕まらない。** save ボタンは `renderSettings` が `innerHTML` 経由で生成するため、テストがリスナ登録より先に要素への参照を持てない。他の 3 モジュールが使った `trackClickListener`（要素に `vi.spyOn`）は使えないため、`EventTarget.prototype.addEventListener` に spy を置き、`mock.contexts[i]`（各コールの `this`）でノードを突き合わせる方式にした。container 側は DOM fixture が init 前から存在するため要素ローカルの spy でも可だが、判定を 1 方式に揃えた。

**`init()` は配線前に前回の teardown を流す（release-then-wire）。** `renderSettings` は container の *子* を置き換えるので container 要素自体は生き残り、destroy を挟まずに init を 2 回呼ぶと container の `input` リスナが重複する。3 つの sibling は init で先に `removeEventListener` を呼ぶ方式（markdownTemplateManager）か append のみ（trustSettings）だが、本モジュールは `listen()` の teardown 配列を 1 か所に集約しているため、init の先頭で `teardown.splice(0)` を実行する形にした。テストで「生存 container に対する 2 回目の init が input リスナを積まない」ことを固定している。

**既定値リテラルを `resetToDefaults()` に集約した。** 8 個の既定値は「宣言時の初期化」「`loadConditionsSettings` の catch」「`destroy()` 後のリセット」の 3 箇所に同値で書かれていた。3 箇所を 1 つの関数に寄せ、save ハンドラが保持する値の基準点と破棄後の基準点がずれないようにした。値は従来どおりリテラル（`5` / `50` / `1000` / `0` / `1000000` / `10` / `10000` / `30000`）で、`DEFAULT_MIN_VISIT_DURATION` 等の定数への置き換えはしていない（別 PBI のスコープ）。`loadConditionsSettings` の正常系の `??` フォールバックは定数のまま。

**`staticPanels.ts` / `staticPanelAdapter.ts` は無改変。** `panel-recording-conditions` の spec は `mount: () => initRecordingConditionsSettings()` のままで、factory 化はこの 1 層の下の委譲だけで完結した。

### 検証

```
npx vitest run src/dashboard/__tests__/dashboardLegacyPanelFactories.test.ts   →  15 tests passed
npx vitest run src/dashboard/__tests__/recordingConditionsSettings.test.ts
                src/dashboard/__tests__/recordingConditionsSettings.branches.test.ts
                src/dashboard/__tests__/recordingConditionsSettings-seam.test.ts  →  3 files / 39 tests passed（無改変）
npx vitest run src/dashboard/__tests__                                          →  87 files / 1138 tests passed
npx vitest run <変更テストファイル> × 5 回                                       →  15 tests passed / 回（5/5 green）
npx eslint src/dashboard/recordingConditionsSettings.ts
           src/dashboard/__tests__/dashboardLegacyPanelFactories.test.ts        →  issues なし
npx tsc --noEmit -p tsconfig.json                                                →  error 0 件
```

既存 39 テストは 1 件も修正せず green のままだった。すなわち当モジュールの既存 spec は module-global の持ち越しに依存していなかった。

回帰ガード（挙動を戻して新テストが落ちることを確認済み）:

- `destroy()` の teardown ループを削除 → 「destroy() removes exactly the listeners init() registered」が失敗
- `init()` 冒頭の release-then-wire を削除 → 「a second init() on a surviving container does not stack its input listener」が失敗

### 未実施・逸脱

- **`npm run validate` は実行していない（指示による）。** `npx tsc --noEmit` は error 0 件で通る。`DoD` の「`npm run validate` が通る」は未チェックのまま残る。
- **公開 API の据え置きは `initRecordingConditionsSettings` のみ。** production の呼び出し元は `staticPanels.ts:42` の 1 箇所で、既存 spec 3 ファイルは module-level 版を直接呼ぶ。`recordingTriggerManager.ts` は本モジュールを import していない（保存先 keys についてのコメント参照のみ）。`destroyRecordingConditionsSettings` は production 呼び出し元が無いが、他の 3 モジュールと同じ「panel 破棄経路を対称にする」命名で export した。`staticPanels` の `StaticPanelSpec` に `destroy` を足す余地は本 PBI のスコープ外（`refresh` だけを持つ契約）。
- **既存 spec への追随修正は不要だった。** `recordingConditionsSettings` の既存 spec 3 ファイルは module-global への依存が無く、無改変で green。
