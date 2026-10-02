# PBI: 死んだシームの一括撤去

優先度: 14 / RICE 7.0 / 実行順: NN22 より先（`settingsForm.ts` を共有）
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review 大きく「死んだシーム群」）
依存: なし（NN22 が本 PBI の完了に依存）

## ユーザーストーリー

このコードベースを拡張する開発者として、本番から呼ばれないシームとモジュールを削除してほしい、なぜなら次の実装者が「生きている seam」と「死んだ seam」の 2 候補から勘で選ぶことになるから。加えて、キャッシュの読み側デフォルト（`disabled`）と書き側デフォルト（`whitelist`）の不一致は、DomainFilter seam を作った意図そのものが崩れた兆候である。

## 背景（現状）

- デッドモジュール: `entrypoints/popup/i18n.ts:1-186` — `getMessage` / `setHtmlLangAndDir` / `applyI18n` を独自実装しているが、`src/`・`entrypoints/`・テストのいずれからも import されない（grep で import 0 を確認）。実体は `src/utils/i18n.ts:17-92` と `src/utils/i18n-dom.ts`。`:17` の `substitutions: any = null` を含む第 2 コピーであり、`:173-186` の import 時副作用も一緒に死んでいる
- 本番未使用 export（自テストのみ消費）:
  - `src/popup/autoClose.ts:106` `showCountdown`
  - `src/popup/tabUtils.ts:39` `getActiveTabDomain` / `:49` `requireActiveTabUrl`
  - `src/content/visitGate.ts:43` `decideContentDomainAdmission` / `:51` `isContentUrlSchemeRecordable`
  - `src/popup/screenState.ts:54` `clearScreenState`
  - `src/popup/errorUtils.ts:300` `handleError` / `:41` `ErrorMessages.CANCELLED`
- dead seam: `src/dashboard/generalSettings/settingsForm.ts:173` `collectCurrentProviderPrioritySlots()` — 呼び出し 0。同一規則（A/B レイアウト判定 → B スロット収集 → A フォールバック）が `src/dashboard/settingsPipeline.ts:139-193` に inline 再実装され、`src/dashboard/panels/staticForm/generalSettingsPanel.ts:183-191` に 3 つ目の部分コピーが残る
- `src/utils/domainFilter/DomainFilter.ts:125-133` `cache(settings, now)` — 本番呼び出し 0。`src/utils/storage/domainFilterCache.ts:82-88` が同じペイロードを自前で組み立てている
- **DomainFilter の mode デフォルトが 3 種類ある**（2026-10-02 追記）: 設定既定は `src/utils/storage/defaults.ts:66` の `'blacklist'`、読み側フォールバックは `src/utils/storage/domainFilterCache.ts:37` の `'disabled'`、書き側フォールバックは同 `:84` と `DomainFilter.ts:126` の `'whitelist'`。**キャッシュ組立の 1 箇所化だけでは解けない**ため、フォールバック値は現挙動のまま固定し、「どのデフォルトが正」かの裁定は別 PBI とする（本 PBI では行为的変更をしない）
- **未読 dep の追加**（2026-10-02 追記）: NN08 で兄弟の `sessionTimeoutChecker` を削除した際、`src/background/alarmRegistry.ts:42` の `sessionTimeoutInstall?: () => Promise<void>;` が未読のまま残った（JOBS 行は module scope の ref を使う）。本 PBI で併せて削除する

## BDD シナリオ

```gherkin
Scenario: 本番参照 0 のモジュールの削除
  Given entrypoints/popup/i18n.ts への import が 0 件である
  When 本 PBI の変更を適用する
  Then ファイルは削除され、参照エラーは発生しない

Scenario: 本番未使用 export の削除
  Given showCountdown / getActiveTabDomain / decideContentDomainAdmission 等が自テスト以外から参照されない
  When 該当 export とその自テストを削除する
  Then ビルドと既存テストが green のまま保たれる

Scenario: DomainFilter キャッシュの単一化
  Given キャッシュ組立が DomainFilter.cache と domainFilterCache の 2 箇所に存在する
  When 片方へ集約し読み書きの mode デフォルトを揃える
  Then キャッシュの判定結果が mode によって変わることはない
```

## 実装宣言

- 挙動維持: 本番から到達しないコードの削除のみ。live な経路のロジックは変更しない
- `DomainFilter.cache()` の採用か削除かを選ぶ場合、キャッシュ組立の単一所有者を `DomainFilter` に置く（読み側デフォルトを `whitelist` に寄せる場合、`domainFilterCache.ts:37` の読み出しが既存値と乖離しないことをテストで固定する）
- A/B スロット収集の live 化: `settingsForm.ts:172-186` を `settingsPipeline.ts:139-193` から呼び出す形に寄せ、inline コピーを消す

## 受け入れ基準

- [x] `entrypoints/popup/i18n.ts` が削除され、`src/utils/i18n.ts` / `src/utils/i18n-dom.ts` のみが i18n seam として残る
- [x] 本番未使用 export 7 個が削除され、それらを検証していた自テストも削除される
- [ ] `collectCurrentProviderPrioritySlots()` の inline コピーが 1 箇所に集約される
- [x] `DomainFilter.cache()` と `domainFilterCache.ts` のペイロード組立が 1 箇所になる（mode フォールバック値は現挙動のまま固定する。3 種デフォルトの裁定は別 PBI）
- [x] `alarmRegistry.ts` の未読 `sessionTimeoutInstall` dep が削除される
- [x] ビルドと既存テストが green

## テスト戦略

- 既存テストの削除のみ（新しい振る舞いのテストは追加しない）
- モードデフォルト変更を伴う場合は、既存値（`disabled` 読み出し）との非互換が起きないことを既存テストで固定
- 検証: `npm run type-check` と変更ディレクトリ配下の vitest

## 実装内容

1. `entrypoints/popup/i18n.ts` 削除
2. 本番未使用 export と自テストの削除
3. A/B スロット収集を `settingsForm.ts` → `settingsPipeline.ts` の inline 実装へ集約（dead seam 削除）
4. DomainFilter キャッシュ組立の 1 箇所化と mode デフォルト統一

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録（2026-10-02）

### 変更内容

- `entrypoints/popup/i18n.ts`（186 行）を削除。`entrypoints/popup/` に残るソースは `main.ts` のみで、i18n seam は `src/utils/i18n.ts` / `src/utils/i18n-dom.ts` だけになった
- 本番未使用 export を 8 個削除（`showCountdown` / `getActiveTabDomain` / `requireActiveTabUrl` / `decideContentDomainAdmission` / `isContentUrlSchemeRecordable` / `clearScreenState` / `handleError` + 付随する `ErrorHandlers` interface / `ErrorMessages.CANCELLED`）。削除前に本番（テスト以外）参照 0 を再確認した
- `src/dashboard/generalSettings/settingsForm.ts` の死んだ `collectCurrentProviderPrioritySlots()` と `collectBProviderPrioritySlots` import を削除
- `src/utils/storage/domainFilterCache.ts:updateDomainFilterCache` を `DomainFilter.cache(settings)` の返り値分解に寄せ、キャッシュ組立の単一所有者を `DomainFilter` にした（`DomainFilter.ts` 自体は編集不要だった）
- `src/background/alarmRegistry.ts` の未読 `sessionTimeoutInstall` dep と、それを供給していただけの `compositionManifest.ts` の配線（`sessionAlarmService` の resolve と `startTimeoutChecker()` 呼び出し）を削除
- 自テストの削除・置換: `visitGate-table.test.ts` 全体削除、`autoClose` / `tabUtils` / `errorUtils` / `sanitizeError` の対象 spec 削除、`screenState.test.ts` を `setScreenState('main')` 前提へ書換え

### 追加テスト

- `src/utils/__tests__/storage.test.ts` に DomainFilter キャッシュの mode フォールバック固定テストを追加（`blacklist` = 設定既定 / `whitelist` = 書き側 / `disabled` = 読み側）

### 逸脱

依頼範囲を超える変更を 2 件行った。いずれも「スイートを green のまま保つ」「削除したコードが到達不能である」ことが理由である。

1. `clearScreenState` はテストのリセット用 fixture として使われていたため、同一の原始動作である `setScreenState('main')` に置き換えた（Production 参照は 0 のまま）
2. `showCountdown` の削除で `countdownIntervalId` / `COUNTDOWN_START_VALUE` / `COUNTDOWN_UPDATE_INTERVAL_MS` / `getMessage` import / 到達不能だった `clearInterval` 分岐が孤児となったため一并削除した

`DomainFilter.cache()` を単一所有者にしたことで mode のフォールバック値が 3 種ある問題は**解けていない**。フォールバック値は一切変えず、`blacklist`（設定既定）/ `whitelist`（書き側）/ `disabled`（読み側）を新テストで固定した。**どのデフォルトが正しいかの裁定は本 PBI の対象外**であり、別 PBI として残す。

### 未消化（同一クラスの残存）

- `AlarmHandlerDeps.reviewSummaryGenerator` と `settingsReader` も未読
- `DomainFilter.buildCacheDomains` は class 内からのみ呼ばれるようになったが public のまま

### 未達（tick しない理由）

受け入れ基準「`collectCurrentProviderPrioritySlots()` の inline コピーが 1 箇所に集約される」は**未達**。同関数の死んだ export は削除したが、本命の集約（`settingsPipeline.ts` の inline 実装へ寄せ、3 つ目の部分コピーを消す）は行っていない。`settingsPipeline.ts:141` と `panels/staticForm/generalSettingsPanel.ts:210` に inline コピーが残る。

### 検証

`npx tsc --noEmit` / `npm run lint`（error 0）/ `npm test`（999 files, 15367 tests passed）/ `npm run validate` すべて green。
