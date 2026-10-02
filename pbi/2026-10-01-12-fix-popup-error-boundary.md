# PBI: popup の非同期ハンドラにエラー境界を追加

## 優先度・backlog 出所・依存

- 出所: [pbi/2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md) — 検証済み候補 NN12。
- RICE: R=8 / I=3 / C=1.0 / Eff=1.5 → 16.0（順位 5）。
- 優先度: High。storage 拒否や不正 URL が unhandled rejection になり、ユーザー通知がゼロのまま popup の操作が無音で失敗する。
- 依存: なし。`src/popup/pendingPages.ts`・`src/popup/statusPanel.ts`・`src/popup/privatePageDialog.ts`・`src/popup/privacyConsentController.ts` を触り、バッチA（08/10/11/13/14/15/16/18/23/24/25）とファイル非重複。settingsForm / generalSettingsPanel チェーン（09→17→20）とも非重複。

## ユーザーストーリー

popup で「選択したページを保存」や「ドメインを許可リストに追加」を実行するユーザーとして、storage が拒否されたり URL が不正だったりした場合に、操作が無音で消えるのではなく UI 上に失敗が表示されることを期待する。

## 背景（file:line 付き現状）

検証済み事実: 以下のハンドラは全て await チェーンで try/catch がなく、拒否が unhandled でユーザー通知ゼロになる。

- `src/popup/pendingPages.ts:114-120` — `btn-save-selected` / `btn-save-whitelist` が `saveSelectedPages()` を catch なしで呼ぶ。内部の `recordPendingPage` / `removePendingPages` / `addDomainToWhitelist`（:84・:96・:100）の拒否が unhandled。
- `src/popup/pendingPages.ts:122-142` — `btn-discard` の async ハンドラ。`showConfirmDialog` → `removePendingPages(urls)`（:139）が拒否された場合の catch がない。
- `src/popup/pendingPages.ts:67-75` — `addDomainsOrPathsToWhitelist` の `new URL(url).hostname`（:69）が不正 URL で throw し、バッチ全体（残りの URL だけでなく後続の保存処理）を中断する。1 件の不正 URL でバッチが死なないよう hostname 変換も個別 try が必要。
- `src/popup/statusPanel.ts:315-336` — `addDomainBtn` の async ハンドラ。`getCurrentTab` / `addDomainToWhitelist` / `initStatusPanel` の拒否に catch がない。
- `src/popup/statusPanel.ts:338-354` — `addPathBtn` の async ハンドラ。同様に catch がない。
- `src/popup/statusPanel.ts:146-178` — `btnRequestPermission` の async ハンドラ。`await requestPermission(url)`（:154）と `await recordDeniedVisit(domain)`（:160）の拒否に catch がない。
- `src/popup/statusPanel.ts:375-386` — `btnRequestAllUrls` の async ハンドラ。`await requestAllUrls()`（:377）の拒否に catch がない。
- `src/popup/privatePageDialog.ts:128-136`（`dialog-save-once`）・`:138-151`（`dialog-save-domain`）・`:153-166`（`dialog-save-path`）・`:175-184`（`recording-failed-retry`）— ダイアログ buttons の async ハンドラ。await の拒否時に catch がなく、ダイアログは既に `close()` 済み（:130・:140・:155・:177）のため失敗が UI に残らない。`addDomainToWhitelist`（:147）・`addPathToWhitelist`（:163）・`recordWithForce`（:134・:149・:164）・`recordPendingSave(false)`（:182）の拒否が unhandled。
- `src/popup/privacyConsentController.ts:156-168` — `handleDeclineConsent` が try/catch なし。`await declineConsent()`（:157）の拒否が unhandled。対照として `handleAcceptConsent`（:131-151）は既に try/catch + `logError` + ボタンへのエラー表示（:138-149）を実装済み — 同じモジュール内の兄弟ハンドラで非対称。
- 拒否は現実に発生する: `src/utils/storage/SettingsRepository.ts:197` — `writeSettings` の API key 暗号化失敗経路が `await logError(...)` の後に `throw e` で再 throw する。暗号化が未初期化（master password 未設定・ロック中）のとき、この経路は setAll / set を経由する全 popup 書き込みを reject させる。
- 正解パターンは同プロジェクト内に実在:
  - `src/popup/statusPanel.ts:396-427` — feedback button が try/catch で wrap し、`statusChannel.report(statusEl, ..., 'error')` で UI 表示（:423）+ `logError`（:424）。
  - `src/popup/trancoNotification.ts:70-98` — `handleTrancoGrant` / `handleTrancoDeny` が try/catch + `logError`（:81・:96）で wrap。

## BDD

### Scenario 1: storage 拒否時に unhandled rejection にならず UI に失敗が出る

```gherkin
Given popup の saveSelectedPages が recordPendingPage を呼ぶ
And recordPendingPage が storage 拒否で reject する
When ユーザーが btn-save-selected をクリックする
Then unhandled rejection が発生しない
And mainStatus に失敗メッセージが表示される
And logError に原因付きで記録される
```

### Scenario 2: 不正 URL の 1 件でバッチ全体が死なない

```gherkin
Given 選択済み URL のリストに "not a url" と "https://example.com/page" が含まれる
And ユーザーが btn-save-whitelist をクリックした
When 1 件目の hostname 変換で new URL が throw する
Then 1 件目は個別に catch され失敗が UI に表示される
And 2 件目 "https://example.com/page" の whitelist 追加は実行される
And 後続の保存処理（recordPendingPage / removePendingPages）は通常どおり完了する
```

### Scenario 3: ダイアログ閉鎖後の拒否が UI に残る

```gherkin
Given private-page-dialog が表示されている
And ユーザーが dialog-save-domain をクリックした
And ダイアログは close() 済みである
And addDomainToWhitelist が storage 拒否で reject する
Then unhandled rejection が発生しない
And 失敗が popup のステータス表示に出る
```

## 実装宣言・受け入れ基準

実装宣言: **It must keep behavior** — 全ハンドラの成功経路（保存が完了した場合の UI 遷移・再描画・メッセージ）は不変。失敗時の catch → `showStatus` / `statusChannel.report` / エラー表示の追加のみを行う。`wireOnce`（`statusPanel.ts:146-147`・`:375-376`・`:396` の重複ハンドラ防止契約）と閾値トーストの timer token 管理（`statusPanel.ts:166-175`）は移設しない・壊さない。拒否時の `handleDeclineConsent` のモーダル非表示（:159）と拒否回数 3 回以降の警告抑制（:161-163）の成功経路も維持する。

受け入れ基準:

1. 上記 ~10 ハンドラのいずれで storage 拒否・例外が発生しても unhandled rejection にならない（コンソールに unhandled error が出ない）。
2. 失敗が UI に出る: 各ハンドラに対応するステータス領域（`mainStatus` / `reportCleansingFeedbackStatus` 相当 / ボタンラベル / ダイアログ後のステータス）にエラーメッセージが表示される。既存の成功メッセージの表示形式と同一の seam を使う。
3. 成功経路の挙動は不変: 全ハンドラの既存の成功時の UI 遷移・再描画・メッセージ・モーダル制御が既存テストどおり動く。
4. `new URL(url).hostname` の hostname 変換（`pendingPages.ts:69`）が個別 try で wrap され、不正 URL 1 件でバッチ全体（他 URL の処理と後続の保存処理）が中断されない。
5. `handleDeclineConsent`（`privacyConsentController.ts:156-168`）が `handleAcceptConsent`（:131-151）と対称になり、catch → `logError` + UI 表示を持つ。
6. 既存テストが green（`npm run validate`）。失敗経路の表示は新規テストで担保し、成功経路の既存テストは無変更で通る。

## テスト戦略

- 単体（新規）: 各ハンドラの依存（`recordPendingPage` / `removePendingPages` / `addDomainToWhitelist` / `addPathToWhitelist` / `requestPermission` / `requestAllUrls` / `declineConsent`）を `vi.fn().mockRejectedValue(...)` で拒否させ、(1) `unhandledrejection` が上がらないこと、(2) ステータス領域に失敗メッセージが render されること、(3) `logError` が原因付きで呼ばれることを assert。テストは `await vi.waitFor(...)` や Promise の完了待ちで settle を待ち、`setTimeout` の実時間待ちを入れない（`testDir/waitPolicy.ts` の契約）。
- バッチ分断テスト: `saveSelectedPages` に不正 URL と正常 URL の混在リストを与え、正常 URL の whitelist 追加と後続処理が実行されることを mock 呼び出しで assert。
- 成功経路の退行確認: `src/popup/__tests__/pendingPages.test.ts`・`statusPanel.test.ts`・`statusPanel-extra.test.ts`・`privatePageDialog.test.ts`・`privacyConsentController.test.ts`・`privacyConsentController-r2.test.ts` が無変更で green することを確認。
- 正解パターンとの対称確認: feedback button（`statusPanel-cleansingFeedback.test.ts`）と同型の catch 経路テストを新規ハンドラに倣って配置する。

## 実装内容

1. `src/popup/pendingPages.ts` — `btn-save-selected` / `btn-save-whitelist`（:114-120）・`btn-discard`（:122-142）のハンドラを正解パターン（`statusPanel.ts:396-427` の try/catch + `statusChannel.report` / `showSuccess` と同型のエラー表示 + `logError`）で wrap。`addDomainsOrPathsToWhitelist`（:67-75）はループ内の hostname 変換を個別 try にし、`new URL(url)` 失敗の 1 件を catch して UI に記録し、残りの URL を継続処理する。
2. `src/popup/statusPanel.ts` — `addDomainBtn`（:315-336）・`addPathBtn`（:338-354）・`btnRequestPermission`（:146-178）・`btnRequestAllUrls`（:375-386）を同一パターンで wrap。`btnRequestPermission` の既存の拒否時トースト表示（:161-175）は成功/失敗分岐の内側に温存し、catch はその外側に置く。エラー表示は既存の `statusChannel.report` seam を使う。
3. `src/popup/privatePageDialog.ts` — `dialog-save-once`（:128-136）・`dialog-save-domain`（:138-151）・`dialog-save-path`（:153-166）・`recording-failed-retry`（:175-184）を wrap。ダイアログは既に閉じているため、失敗表示は popup 本体のステータス領域（`mainStatus`）に出す。
4. `src/popup/privacyConsentController.ts` — `handleDeclineConsent`（:156-168）を `handleAcceptConsent`（:131-151）と同じ形（catch → `logError` + ボタンまたはモーダルへのエラー表示）に wrap。
5. 失敗表示の i18n: ユーザー向け文言は既存キーがあれば再利用し、なければ `getMessageOr(key, fallback)` 形式で新キーを定義する（`docs/i18n-guide.md` の data-i18n 契約に従い、`_locales` にも追加）。
6. ガードの移設先の明示: catch の位置は「各ハンドラの最外殻 1 箇所」に統一する。ループ内の hostname 変換のみ例外（個別 try）とする。既存の `wireOnce` / timer token / `releasePrivatePageTrap` / `currentPendingSave = null` の状態操作は catch の外側の成功・失敗共通パスにそのまま残す。

## Definition of Done

- [x] 上記 BDD 3 シナリオがテストとして実装され、green。
- [x] ~10 ハンドラ全てで storage 拒否 → unhandled rejection にならないことを assert するテストが存在する。
- [x] 失敗メッセージが UI に表示されることを assert するテストが存在する。
- [ ] 成功経路の既存テストが無変更で green（`npm run validate`）。
- [x] `npm run type-check` green。
- [ ] backlog（[pbi/2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)）の NN12 として完了報告が紐づく。

## 実装記録（2026-10-02）

### 変更点

- `src/popup/pendingPages.ts` — `reportActionFailure(message, error, errorCode)` を新設し、`#mainStatus` への `showError` と `logError`（cause 付き）を一箇所に集約。`saveSelectedPages()` 全体と `btn-discard` ハンドラを try/catch で囲み、`addDomainsOrPathsToWhitelist()` の hostname 変換を**ループ内の個別 try** にした（受け入れ基準 4）。不正 URL 1 件は `INVALID_INPUT` として記録して `continue` するため、後続 URL と保存パスを巻き込まない。
- `src/popup/statusPanel.ts` — `reportHandlerError(message, error)` を新設し、`addDomainBtn`・`addPathBtn`・`btnRequestPermission`・`btnRequestAllUrls` の 4 ハンドラを try/catch で囲んだ。`btnRequestPermission` の既存拒否トーストは成功/失敗分岐の内側に温存し、catch はその外側にある。`wireOnce` と timer token 管理は移設していない。エラー表示は成功経路と同じ `statusChannel.report('mainStatus', ...)` seam を使う。
- `src/popup/privatePageDialog.ts` — `reportDialogActionFailure(action, error)` を新設し、ダイアログの 4 ボタン（`dialog-save-once` / `dialog-save-domain` / `dialog-save-path` / `recording-failed-retry`）を try/catch で囲んだ。ダイアログは既に `close()` 済みなので失敗表示は popup 本体の `#mainStatus` に出す。`releasePrivatePageTrap` と `currentPendingSave` の状態操作は catch の外側にそのまま残した。
- `src/popup/privacyConsentController.ts` — `handleAcceptConsent` にあったボタンへのエラー表示を `flashButtonError()` として切り出し、`handleDeclineConsent` を同じ形（catch → `logError` + ボタン点滅）にして兄弟ハンドラと対称にした（受け入れ基準 5）。拒否回数 3 回以降の警告抑制は catch の内側のため、成功経路は不変。

### 追加したテスト

- `src/popup/__tests__/pendingPages-errorBoundary.test.ts`（新規・275 行）— `saveSelectedPages` の拒否 3 ケース、不正 URL 混在バッチ 3 ケース（BDD シナリオ 2）、`btn-discard` の拒否 2 ケース。`errorUtils` は意図的に mock せず、ユーザーが実際に読む文言を検証する。
- `src/popup/__tests__/privatePageDialog-recordRejection.test.ts`（新規・167 行）— ダイアログ 4 ボタンの record seam 拒否を検証（BDD シナリオ 3）。
- `src/popup/__tests__/statusPanel-extra.test.ts` — `statusPanel async handlers — rejected dependencies` を 6 ケース追加（addDomain の whitelist 拒否 / addPath の whitelist 拒否 / addDomain のタブ読み取り拒否 / requestPermission の prompt 拒否 / denied-visit 記録の拒否 / requestAllUrls の prompt 拒否）。
- `src/popup/__tests__/privatePageDialog.test.ts` — 閉鎖済みダイアログからの domain / path 書き込み拒否を 2 ケース追加。
- `src/popup/__tests__/privacyConsentController-r2.test.ts` — `handleDeclineConsent` の error branch を 1 ケース追加。
- ハンドラ別の被覆：pendingPages 3 / statusPanel 4 / privatePageDialog 4 / privacyConsent 1。`npx vitest run <batch-B の 11 ファイル> --repeats=20` → 11 files / 301 tests 全回 green。`npm run validate` も green（998 files / 15343 tests）。

### 逸脱・未達

- **既存アサーションの書き換え（未達）。** DoD の「成功経路の既存テストが無変更」は成立しない。`statusPanel-extra.test.ts` の `statusChannel.report('mainStatus'` を出現回数 4 に固定していたアサーションが、共有の失敗レポーター追加で 5 になったため、数値とテスト名（`routes all four mainStatus renders…` → `routes every mainStatus render…`）を変更した。同一テスト内の残り 2 アサーション（`showStatus('mainStatus'` が無いこと／`className = 'success'|'error'` の直接書き込みが無いこと）は無変更。
- **i18n キーを追加していない。** 新しい `_locales` キーが許可範囲外だったため、popup 側の失敗表示は既存キー `errorGeneric`（`An error occurred.`）の汎用文言に寄せた。専用文言にする場合は `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の両方へ追加すること。
- **ダイアログの 2 つの catch は現状到達不能。** `recordPendingPage` は送信失敗を `{success:false}` に正規化し reject しないため、`privatePageDialog.ts` の 2 つの catch は契約変更に対する防御境界であり、今日の production 経路では到達しない。テストはこのため、record seam を明示的に reject する形で境界そのものを固定している。
- **backlog 紐付け（未達）。** 完了報告の紐付けは backlog／台帳更新のステップに委ねている。
- 統合時に 2 件の型エラーを修正した: `pendingPages-errorBoundary.test.ts` と `privatePageDialog-recordRejection.test.ts` の `getMessage` mock が引数 1 個で定義されながら 2 個で呼ばれており（`TS2554: Expected 1 arguments, but got 2`）、`type-check:test` で error になっていた。実際の `chrome.i18n.getMessage` も第 2 引数に省略可能な substitutions を持つため、mock の第 2 引数を `_subs?: string[]` として受け入れる形へ修正した。`validate` は `type-check:test` を含まないため、この 2 件は gates では検出されなかった。
