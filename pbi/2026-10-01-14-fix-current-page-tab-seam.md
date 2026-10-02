# PBI: popup main.ts を tabUtils seam へ追従

## 優先度・backlog 出所・依存

- 出所: [pbi/2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md) — 検証済み候補 NN14。
- RICE: R=6 / I=1 / C=1.0 / Eff=0.5 → 12.0（順位 7）。
- 優先度: Medium。単一 seam への逸脱解消（active-tab read の集約）で、他候補との依存はなし。
- 依存: なし（バッチA 並列候補）。`src/popup/main.ts` とそのテストのみを触り、他候補とファイル非重複。

## ユーザーストーリー

popup の保守担当者として、active-tab の読み取りが popup UI 全体で 1 箇所の seam（`tabUtils.getCurrentTab`）に集約されていることを期待する。raw `chrome.tabs.query` が 1 カ所だけ残っていると、tabs API のモック方針・null 扱い・将来の query 条件変更が二重管理になる。

## 背景（file:line 付き現状）

- `src/popup/main.ts:26-31` — `DOMContentLoaded` ハンドラ内で raw `chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { ... })` を直呼びし、`tabs[0]?.id` で badge の `setBadgeText({ text: '', tabId })` を実行している。コールバック形式の API 呼び出しが popup コード内に残る唯一の箇所。
- 単一 seam は実在: `src/popup/tabUtils.ts:12-16` — `getCurrentTab(): Promise<chrome.tabs.Tab | null>` が `chrome.tabs.query({ active: true, currentWindow: true })` を promise 形式で wrap し、`!chrome.tabs` のガード（:13）と `tab || null` の正規化（:15）を持つ。
- 他の全消費者は使用済み:
  - `src/popup/statusStore.ts:13,23` — `getCurrentTab` を import し使用。
  - `src/popup/recordCurrentPage/recordSession.ts:5,70`（:198・:210・:404 も同様）— `getCurrentTab` を使用。
  - `src/popup/statusPanel.ts:9,317`（:340・:380・:400 も同様）— `getCurrentTab` / `getActiveTabUrl` を使用。
- つまり `main.ts:26-31` だけが seam の外に置かれた active-tab read。
- seam の null ポリシー: `tabUtils.ts:12-16` — タブが取得できない・`chrome.tabs` が無い場合に `null` を返す。`getActiveTabUrl`（:21-24）も `tab?.url ?? null`。呼び出し側は null を早期 return / 分岐で扱うのが既存ポリシー（`statusPanel.ts:318` の `if (tab?.url)` 分岐など）。
- テスト側の現状: `src/popup/__tests__/main-domcontentloaded.test.ts:60-69` が `chrome.tabs.query` をコールバック形式で stub し、`:123` で `chrome.tabs.query` の直接呼び出しを、`:156-165` で `setBadgeText({ text: '', tabId: 123 })` を assert。`:47-50` では `tabUtils` を mock しているが、main.ts がまだ seam を使っていないため mock は現状未接続。`src/popup/__tests__/main.test.ts:36` は既に `getCurrentTab` を mock している。

## BDD

### Scenario 1: active-tab read が 1 箇所に集約される

```gherkin
Given popup main.ts の DOMContentLoaded ハンドラが badge クリアを行う
When DOMContentLoaded が発火する
Then badge クリアのための active-tab read は tabUtils.getCurrentTab 経由で 1 回だけ行われる
And popup ソース内に raw chrome.tabs.query の直呼びが存在しない
```

### Scenario 2: tab が取得できない場合に badge クリアが静かにスキップされる

```gherkin
Given tabUtils.getCurrentTab が null を返す
When DOMContentLoaded が発火する
Then setBadgeText は呼ばれない
And エラーや unhandled rejection が発生しない
And DOMContentLoaded ハンドラの他の処理（initializeModalEvents / loadCurrentTabAndInitStatus / initAllUrlsPermissionBanner）は通常どおり完了する
```

### Scenario 3: tab id が取得できた場合に badge クリアが実行される

```gherkin
Given tabUtils.getCurrentTab が id: 123 の tab を返す
When DOMContentLoaded が発火する
Then chrome.action.setBadgeText が { text: "", tabId: 123 } で 1 回呼ばれる
```

## 実装宣言・受け入れ基準

実装宣言: **It must keep behavior** — DOMContentLoaded 時の badge クリアの外部挙動（tab id が取れたら `setBadgeText({ text: '', tabId })`、取れなければ何もしない）は不変。他の初期化処理（`initializeModalEvents`・`loadCurrentTabAndInitStatus`・`initAllUrlsPermissionBanner`）の順序とエラーログ（`src/popup/main.ts:20-25`）も不変。

受け入れ基準:

- [x] 1. active-tab read が 1 箇所に集約される: `src/popup/main.ts` から raw `chrome.tabs.query` の直呼びが消え、`tabUtils.getCurrentTab` に置換される。popup ソース（`src/popup/**` の production コード）で raw `chrome.tabs.query` を呼ぶのは `tabUtils.ts` のみになる。
- [x] 2. null 時の扱いが seam ポリシーと一致: `getCurrentTab` が `null` を返した場合に badge クリアを静かにスキップし（`tab?.id !== undefined` 分岐相当）、エラーログや例外を出さない。
- [x] 3. tab id が取れた場合の外部挙動は不変: `setBadgeText({ text: '', tabId })` が既存どおり 1 回呼ばれる。
- [x] 4. 既存テストが green: `main-domcontentloaded.test.ts` の `chrome.tabs.query` 直接 stub / 直接 assert は seam mock（`getCurrentTab` が tab または null を返す）を駆動する形に更新され、`main.test.ts`・`mainSpinner.test.ts` を含む popup テスト一式が green。
- [x] 5. `npm run type-check` と `npm run validate` が通る。
- [x] 6. `main.ts` のエラーログ契約（`loadCurrentTabAndInitStatus` / `initAllUrlsPermissionBanner` の `.catch` + `logError`）が無変更で保たれる。

## テスト戦略

- 単体（更新）: `src/popup/__tests__/main-domcontentloaded.test.ts` — `chrome.tabs.query` の callback stub を廃止し、既に mock 済みの `tabUtils.getCurrentTab`（:47-50）を駆動対象にする。`getCurrentTab.mockResolvedValue({ id: 123, url: 'https://example.com' })` で Scenario 3、`mockResolvedValue(null)` で Scenario 2 を assert。待ちは `vi.waitFor(...)`（既存の `interval: 1` 使用パターンを踏襲、`testDir/waitPolicy.ts` の契約に沿い実時間待ちは入れない）。
- 回帰: `main.test.ts`（:36 で `getCurrentTab` を既に mock）・`mainSpinner.test.ts` が green。raw `chrome.tabs.query` 直呼びの逸脱検出は `grep` ベースの確認（popup production コード内に `chrome.tabs.query` が `tabUtils.ts` にしか現れないこと）を実装内容の確認手順として記載。
- E2E は不要 — badge クリアは MV3 popup 起動時の副作用テストで、単体で外部挙動を完全に観測できる。

## 実装内容

1. `src/popup/main.ts` — `:26-31` の raw `chrome.tabs.query({ active: true, currentWindow: true }, ...)` を `getCurrentTab()` await に置換する。`getCurrentTab` から `import { getCurrentTab } from './tabUtils.js'` を追加（ESM import は `.js` 拡張子規約に従う）。
2. null 時の扱いは既存 seam のポリシーに従う: `const tab = await getCurrentTab(); if (tab?.id !== undefined) chrome.action.setBadgeText({ text: '', tabId: tab.id });` — tab が取れない場合は何もせず、ログも出さない（現在の `tabs[0]?.id === undefined` 分岐と同一挙動）。
3. 置換は badge クリア部分のみに限定する。`loadCurrentTabAndInitStatus` 内の `loadCurrentTab()` / `initStatusPanel()`（:9-12）は既に内部で seam を使うため触らない。`main.ts` の export（:7）とログ契約（:20-25）は無変更。
4. `src/popup/__tests__/main-domcontentloaded.test.ts` — `chrome.tabs.query` callback stub（:60-69）と直接 assert（:123・:156-165）を `getCurrentTab` mock 駆動に更新する（受け入れ基準 4）。`chrome.tabs` の stub 自体は `tabUtils` の `!chrome.tabs` ガード（`tabUtils.ts:13`）を通すため最低限残すか、mock 経由で到達しない場合は削除する。
5. コメントは追加しない（seam への置換は自明。逸脱検出は grep で確認可能）。

## Definition of Done

- [x] 上記 BDD 3 シナリオがテストとして実装され、green。
- [x] popup production コード内の raw `chrome.tabs.query` が `src/popup/tabUtils.ts` のみになる（grep で確認）。
- [x] `getCurrentTab` null 時に `setBadgeText` が呼ばれないことを assert するテストが存在する。
- [x] 既存テスト一式が green（`npm run validate`）。
- [x] `npm run type-check` green。
- [ ] backlog（[pbi/2026-10-01-00-backlog-holistic-1001.md](pbi/2026-10-01-00-backlog-holistic-1001.md)）の NN14 として完了報告が紐づく — アーカイブ/台帳更新は別ステップで処理。

## 実装記録（2026-10-02）

変更した内容:

- `main.ts` — DOMContentLoaded ハンドラ内の raw `chrome.tabs.query({ active: true, currentWindow: true }, cb)` を新しい `clearActionBadge()` 関数に置き換え、`tabUtils.getCurrentTab()` を await して `tab?.id !== undefined` のときだけ `chrome.action.setBadgeText({ text: '', tabId: tab.id })` を呼ぶ形にした。DOMContentLoaded の他の初期化（`initializeModalEvents` / `loadCurrentTabAndInitStatus` / `initAllUrlsPermissionBanner`）と、それらの `.catch` + `logError` のログ契約は位置・順序とも無変更
- badge クリアは best-effort なので `clearActionBadge()` を `try/catch` で包み、active-tab 読み取りの失敗が popup 起動の残り部分を止めない形にした（badge は前回録音の残骸であり、読み取り失敗で起動全体を壊す必要はない）

`main-domcontentloaded.test.ts` の更新:

- `chrome.tabs.query` の callback スタブは「main.ts が直接呼んではいけない」という tripwire として残置し、判定対象を `tabUtils.getCurrentTab` の mock（tab を返すケースと null を返すケース）へ切り替えた
- `contains no raw chrome.tabs.query`（`main.ts` のソースを grep する逸脱検出）を追加
- `reads the active tab through the seam instead of chrome.tabs.query`（`getCurrentTab` が id 123 の tab を返す → `setBadgeText({ text: '', tabId: 123 })` が 1 回、`chrome.tabs.query` は 0 回）を追加
- `getCurrentTab` が null のとき `setBadgeText` が呼ばれない scenario を追加

逸脱なし。検証: `rg chrome.tabs.query src/popup/` の production コード hits は `src/popup/tabUtils.ts:14` のみ（他はすべてテスト内）。`npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。
