# PBI: 同意拒否と撤回後の再同意導線の設計

種別: investigate

## ユーザーストーリー

一度同意を拒否したユーザーとして、拒否後の案内が指す設定画面から明示的に再同意できるようにしたい。記録を停止し、同意を撤回したユーザーとしても、履歴を明示的に操作したうえで同意を戻す道が必要である。

製品担当者と実装者として、popup または dashboard のどちらに再同意の入口を置くか、明示操作で 30 日抑制を bypass するか、撤回後の履歴とバックアップをどう扱うかを裁定し、その後の `feat` または `fix` 実装に分割できる状態にしたい。

## ビジネス価値

- 拒否後に「後から設定画面で同意できる」と案内される一方、実在する再同意導線がない不整合を解消する。
- 破壊的な同意撤回だけでなく、同意を明示的に戻す操作を対称に提供する。
- `acceptConsent()` が拒否カウンタをリセットしない現状により、再同意直後の撤回で古い拒否履歴から新しい 30 日抑制が発生する不整合を防ぐ。
- 自動表示とユーザーによる明示操作を別の状態として裁定し、30 日抑制と再同意権限の関係を明確にする。
- 撤回による端末内データ削除と、外部バックアップ、Obsidian markdown、local Markdown の残存を混同しない案内と状態遷移を定める。

## 優先度

順位: 24 / 30
RICEスコア: 0.5（Reach=2 / Impact=1 / Confidence=50% / Effort=2 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 拒否後に案内される再同意導線を実在させる
  Given 利用者が privacy consent を拒否済みで、dashboard には Privacy Consent Status がある
  And 拒否後の案内は後から設定画面で同意できると表示する
  When 調査成果として再同意 UX を裁定する
  Then 拒否済みの利用者から裁定された再同意入口へ到達できる
  And 既存の明示同意 modal を開いてから同意できる
  And 再同意で checkbox とポリシー確認を省略しない
  And 新しい表示文言と button label は en/ja parity を維持する

Scenario: 同意撤回後も明示的に再同意できる
  Given 利用者が privacy consent を撤回済みで、dashboard の Withdraw Consent が hidden になる
  When 利用者が裁定された再同意入口を選択する
  Then 既存の明示同意 modal が開く
  And checkbox とポリシー確認を含む明示操作だけで同意状態を進められる
  And 同意的操作だけで端末内の履歴を自動復元しない
  And データ削除に失敗した場合の同意状態を変更しない順序を維持する

Scenario: 自動抑制と明示的な再同意操作を分離する
  Given 利用者が 3 回拒否し、30 日の抑制期間にいる
  And 通常の popup 起動では同意確認を自動表示しない
  When 利用者が裁定された明示的な再同意操作を行う
  Then 明示操作は自動表示とは別の判定で扱われる
  And 明示操作で 30 日抑制を bypass するかどうかが状態遷移として明記されている
  And 自動表示の抑制状態が明示操作で変更されるか保持されるかが明確である

Scenario: 再同意直後の撤回で古い拒否履歴を再発火させない
  Given 利用者が 3 回拒否し、30 日後に明示的に再同意する
  And denial counter の reset 方針が別の 0.5 SP の fix として切り出されている
  When 利用者が再同意直後に同意を撤回する
  Then 古い拒否時刻が新しい 30 日抑制を発生させない
  And denial counter の reset 契約と所有元が後続 fix に定義されている

Scenario: バックアップ復元後に同意状態を混同しない
  Given combined encrypted backup は SQLite DB を復元し、allowlist 付き settings を復元する
  And privacy_consent は restore allowlist にないため、同意状態は復元先プロフィルの状態が残る
  When 再同意 UX とバックアップ復元後の案内を裁定する
  Then バックアップ復元だけで同意済み状態になることはない
  And 再同意後に履歴復元を促すか、促さないかを裁定している
  And device-local consent を import 対象から完全に除外するか裁定している
```

## 受け入れ基準

- [ ] 提示された3案、すなわち popup の常時表示バナー、dashboard の re-consent hub、記録停止と同意撤回・履歴削除の分離を比較し、採用案または採用組み合わせを裁定している。
- [ ] 拒否後の「設定画面から同意できる」文言に対応する、実在する再同意入口が特定されている。
- [ ] 撤回後は Withdraw Consent が hidden になる現状に対し、撤回済みの状態から再同意へ到達する経路が定義されている。
- [ ] 再同意は checkbox とポリシー確認を省略しない。少なくとも現在の明示同意 modal を再利用한다。
- [ ] one-click で `acceptConsent({contentStorageEnabled})` を直接呼ぶ設計を採用していない。
- [ ] 未同意、1〜2回の拒否、3回拒否後の30日抑制、撤回済み、同意済みの各状態について、popup 自動表示と明示的な再同意操作の結果を表へ整理している。
- [ ] 30日抑制を明示操作で bypass するかどうかが裁定されている。
- [ ] 自動表示の抑制状態と明示 button の override 状態を、裁定された責務で分離している。
- [ ] `acceptConsent()` の denial counter reset を、UX 裁定を待たずに実施できる 0.5 SP の `fix` として切り出している。
- [ ] 3回拒否、30日後の accept、accept 直後の withdraw で、古い拒否履歴が新しい 30 日抑制を発生させない契約が後続 fix に含まれている。
- [ ] withdraw 後も既存履歴の保持を許すか、同意撤回と履歴削除を常に分離するかを、法的 semaphore の要否を含めて裁定している。
- [ ] withdrawal が端末内 SQLite を削除しても、ダウンロード済み Archive、Obsidian markdown、local Markdown を削除しない現状が UX 上の説明に含まれるか裁定されている。
- [ ] combined encrypted backup 復元時に `privacy_consent` は allowlist にないため、復元先プロフィルの同意状態が残ることを反映している。
- [ ] 再同意後に backup recovery を促すか、促さないかを裁定している。
- [ ] device-local consent を通常の settings export/import の対象から完全に除外するかを裁定している。
- [ ] 新しい表示文言と button label は `data-i18n` または `getMessage()` を使い、en/ja parity を維持する。
- [ ] 再同意 modal は focus trap、keyboard order、`aria-live`、focus return を満たす。
- [ ] 現在の modal で ESC を意図的に無効化している挙動を維持するか、裁定結果として明示している。
- [ ] withdraw は `clearAllLogs()` の完了後に `withdrawPrivacyConsent()` を呼び、データ削除失敗時は同意状態を変えない順序を維持する。
- [ ] withdraw の意味論または外部バックアップの説明を変更する場合、`PRIVACY_POLICY_VERSION` と `public/PRIVACY.md` / `docs/PRIVACY.md` を同時に更新し、両ファイルのバイト一致を維持する。
- [ ] `reconsentConsent()` は存在しないため、既存 API の再利用か新規 API が必要かを裁定結果へ明記している。
- [ ] 既存 API 形状として read、accept、decline、withdraw の契約を調査記録に残している。
- [ ] decline 後の再同意、withdraw 後の再同意、30日 bypass、バックアップ復元後の同意状態を確認する後続 E2E が特定されている。
- [ ] UX 裁定後の実装は、導線追加に応じた `feat` と denial counter reset などの不整合修正に応じた `fix` に分割されている。
- [ ] 本 PBI は調査と裁定に限定し、production code を変更していない。

## テスト戦略（t_wadaスタイル）

本 PBI は調査に限定するため、テストは実行・追加しない。裁定結果から、後続 `feat` または `fix` の Outside-In テスト契約を確定する。

### E2Eテスト

- 後続実装では、拒否後に dashboard の Privacy 画面を開き、案内に対応する再同意入口から明示同意 modal へ到達できることを確認する。
- 後続実装では、撤回済み状態で Withdraw Consent が hidden でも、裁定された再同意入口から同じ modal を開けることを確認する。
- 後続実装では、3回拒否後の30日抑制中も、通常 popup の自動表示と明示 button の扱いが裁定どおり分離されることを確認する。
- 後続実装では、30日後の accept、直後の withdraw、次の popup 起動を連続実行し、古い denial 履歴による新しい30日抑制が発生しないことを確認する。
- 後続実装では、modal の focus trap、keyboard order、`aria-live`、focus return、ESC の裁定済み挙動を実際の Keyboard 操作で確認する。
- 後続実装では、combined encrypted backup の復元前後で、同意状態が復元先プロフィルの契約どおりであることを確認する。
- `testDir/e2e/privacy-consent.spec.ts:12-150` は modal 構造と accessibility を検査するが、accept/decline 操作は fixme であるため、後続実装で操作を完了させる。

### 統合テスト

- `getPrivacyConsent()`、裁定済みの再同意 API、`acceptConsent({contentStorageEnabled})`、`declineConsent()`、`withdrawPrivacyConsent()` を一つの状態遷移として確認する。
- popup の初期同意表示と dashboard の Privacy Consent Status が、裁定した同一 state model を参照することを確認する。
- 1〜2回の拒否、3回拒否後の30日抑制、明示操作での override、再同意後の denial counter reset、撤回を fake clock と storage fixture で確認する。
- `privacySettingsPanel.ts` の `clearAllLogs()` から `withdrawPrivacyConsent()` への順序と、削除失敗時に同意状態が変わらないことを controller 結合テストで確認する。
- combined encrypted backup の DB 復元、allowlist 付き settings 復元、privacy_consent 非復元、および通常の settings export/import の sanitize 境界を統合テストで確認する。
- en/ja の新しい文言と button label を locale fixture で確認し、並列実装する `_locales` 変更との衝突を検出する。

### 単体テスト

- 裁定した状態遷移表の各 edge について、未同意、1〜2回拒否、3回拒否、30日経過、撤回済み、同意済みを確認する。
- 自動表示の30日抑制判定と、明示 button の override 判定を別々の純粋な判定として検証する。
- 3回拒否、30日後の accept、accept 直後の withdraw、denial counter reset の境界値を fake clock で検証する。
- denial counter の1、2、3、4回目の遷移と、accept 後の reset 契約を検証する。
- 再同意 modal が checkbox 未確認、政策未確認、同意操作、キャンセル、focus return の各分岐をどう扱うか検証する。
- 欠落、malformed、古い consent state に対する裁定済みの扱いを検証する。
- backup recovery の提示有無と device-local consent の import 除外について、裁定した分岐を検証する。

## 実装アプローチ

1. 初回同意、1〜2回の拒否、3回拒否、30日抑制、撤回、accept の現状フローを state transition table に整理する。
2. popup の再同意バナー、dashboard の re-consent hub、記録停止と撤回・履歴削除の分離を比較する。
3. 5 Whys を使い、非対称な操作負荷の起点、案内と導線の不一致、既存 modal と state API の再利用可否、one-click 化できない理由、製品判断の分離を整理する。
4. 採用する再同意入口と、撤回済み・拒否済み・30日抑制中の各状態での表示を決める。
5. 自動表示の30日抑制と、明示操作の override を別の state または判定 contract として定義する。
6. denial counter reset を 0.5 SP の独立した `fix` として切り出し、再同意直後の撤回を含む状態遷移を割り付ける。
7. 撤回後の履歴保持、同意撤回と履歴削除の分離、外部バックアップの扱い、backup recovery の促し方を裁定する。
8. 現在の明示同意 modal の checkbox、ポリシー確認、focus trap、keyboard order、`aria-live`、focus return、ESC の扱いを再同意導線へ引き継ぐ。
9. 新しい文言と button label を en/ja で定義し、`data-i18n` または `getMessage()` の採用方針を決める。
10. 既存 API の再利用または新規 API 要否、withdraw のデータ削除順序、backup restore の同意状態境界を裁定結果へ記載する。
11. E2E、統合、単体の Outside-In テスト契約を後続 PBI へ落とし、`feat` と `fix` の垂直 slice として分割する。

## 見積もり

2 SP

UX 裁定、状態遷移表、テスト契約、後続 PBI 分割を対象とする。`acceptConsent()` の denial counter reset は、本 PBI の実装範囲に含めず、0.5 SP の別 `fix` とする。

## 技術的考慮事項

- 依存関係はない。ただし、`pbi/2026-09-25-09-fix-popup-untranslated-title-token.md` と `pbi/2026-09-25-10-investigate-preset-prompt-locale.md` とは `_locales` を共有するため、並列実装時は競合する。
- 初回同意は popup の native dialog として実装され、markup と controller が分離されている。再同意では同じ明示確認を再利用する。
- dashboard には Privacy Consent Status があるが、同意済みなら Withdraw Consent のみを表示し、撤回後は element を hidden にする。再同意状態は別 element として扱う必要がある。
- 1〜2回の拒否では次回 popup 起動時に再表示し、3回拒否後は30日抑制に入る。cooldown の判定は popup 自動表示だけに限定するか、明示操作にも共有するか裁定する。
- `acceptConsent()` は `contentStorageEnabled` も保存し、denial counter をリセットしない。既存同意履歴を上書きし得るため、one-click 化和はしない。
- `reconsentConsent()` は存在しない。read、accept、decline、withdraw の既存 API を組み合わせるか、意図が明確な API を追加するかを裁定する。
- withdraw は `clearAllLogs()` の後に `withdrawPrivacyConsent()` を呼ぶ。データ削除に失敗した場合、同意状態を変更しない順序を維持する。
- withdrawal は端末内 SQLite を削除するが、ダウンロード済み Archive、Obsidian markdown、local Markdown は削除しない。再同意を履歴復元として説明しないよう、この境界を明示する。
- combined encrypted backup は DB と allowlist 付き settings を復元するが、`privacy_consent` は allowlist にない。同意状態は復元先プロフィルの状態が残る。
- 通常の settings export/import は provider-origin state と API key を sanitize する。privacy consent の import 対象を再定義する場合は、この境界と競合しないことを裁定する。
- `PRIVACY.md` を変更する場合は `public/PRIVACY.md` と `docs/PRIVACY.md` を同時に更新し、`scripts/release-checks/check-privacy.mjs:4-10,29-38` のバイト一致を維持する。
- withdraw の意味論または外部バックアップの説明を変更する場合は `PRIVACY_POLICY_VERSION` の更新要否も裁定する。
- modal は ESC を意図的に無効化している。再利用時に、この挙動と keyboard order、focus trap、`aria-live`、focus return の契約を一つの accessibility テストへまとめる。
- 新しい user-facing text は固定文字列を加えず、`data-i18n` または `getMessage()` を使う。en/ja の key parity を維持する。
- 既存の decline counter、30日ルール、通知、dashboard withdrawal、modal controller には先行テストがあるが、decline 後の再同意、withdraw 後の再同意、30日 bypass、backup restore 後の同意状態を確認する active E2E はない。

## 実装者向け注記

### 現状コードの確認

- 初回同意の起動は `src/popup/popup.ts:25-45` にある。
- 初回同意 modal の markup は `entrypoints/popup/index.html:270-315` にある。
- modal の状態表示、accept、decline、通知は `src/popup/privacyConsentController.ts:53-109,128-168` で扱われる。
- 同意済みと撤回済みの表示切替は `src/dashboard/panels/staticForm/privacySettingsPanel.ts:19-61` にある。
- dashboard の Privacy Consent Status は `entrypoints/options/index.html:1582-1590` にある。
- `getPrivacyConsent(): Promise<PrivacyConsentState>` は `src/utils/storage/privacyConsent.ts:18-28,63-123` にある。
- `acceptConsent({contentStorageEnabled})` は `src/utils/storage/privacyConsent.ts:353-370` にあり、denial counter をリセットしない。
- `declineConsent(): Promise<number>` は `src/utils/storage/privacyConsent.ts:372-380` にあり、1〜2回後は次回 popup、3回後は30日抑制となる。
- `withdrawPrivacyConsent(): Promise<PrivacyConsentWithdrawal>` は `src/utils/storage/privacyConsent.ts:226-259` にある。
- `reconsentConsent()` は存在しない。
- decline 後の通知は `src/popup/privacyConsentController.ts:153-167` と `public/_locales/ja/messages.json:2319-2320` にあり、後から設定画面で同意できると案内する。
- popup の privacy consent URL と output は `src/popup/privacyConsentController.ts:197-201` で、ESC を意図的に無効化している。
- combined encrypted backup の復元順序は `src/dashboard/encryptedBackupService.ts:90-100`、restore allowlist は `src/utils/storage/restorableSettings.ts:41-164` にある。
- 通常の settings export/import の sanitize 対象は `src/utils/settingsExportImport.ts:64-83,519-532` にある。
- withdrawal と外部バックアップの説明は `public/PRIVACY.md:243-249` にある。
- accessibility 要件は `docs/ACCESSIBILITY.md:28-53,320-348` にある。
- 既存テストとして `src/popup/__tests__/privacyConsent.test.ts:87-198,317-415`、`privacyConsent-version.test.ts:186-338`、`src/popup/__tests__/privacyConsentController.test.ts:275-390`、`privacyConsentController-r2.test.ts:112-248` がある。
- dashboard の既存テストは `src/dashboard/panels/staticForm/__tests__/privacySettingsPanel.test.ts:80-204` にある。
- `testDir/e2e/privacy-consent.spec.ts:12-150` は modal 構造と accessibility を検査するが、accept/decline 操作は fixme である。

### 実装手順

1. 初回同意、decline、3回拒否、30日抑制、withdraw、accept の現状を同じ state transition table に記録する。
2. popup の再同意入口、dashboard の re-consent hub、記録停止と撤回・履歴削除の分離の3案を、同じ受け入れ基準で比較する。
3. decline 文言が指す「設定画面」と、撤回後に実在する入口を対応付け、採用案を一つまたは組み合わせとして裁定する。
4. popup 自動表示と明示 button の操作を別の state または判定 contract として定義し、30日 bypass の採否を決める。
5. 再同意 modal の checkbox、ポリシー確認、accept、cancel、focus return を既存 controller にどう接続するか裁定する。
6. denial counter reset を 0.5 SP の `fix` として切り出し、30日後の accept と accept 直後の withdraw を含む test contract を残す。
7. 撤回後の既存履歴保持と、同意撤回・履歴削除の分離を裁定する。法的 semaphore の評価が必要なら、その判断を本 PBI の完了条件にする。
8. ダウンロード済み Archive、Obsidian markdown、local Markdown が残ることを、再同意 UI の説明へ含めるか裁定する。
9. combined encrypted backup 復元後に同意状態が復元先プロファイルに残ることを前提に、backup recovery の促し方と device-local consent の import 除外を裁定する。
10. 新規文言と button label を en/ja parity で定義する。並列 PBI と `_locales` が競合する実装順を決める。
11. focus trap、keyboard order、`aria-live`、focus return、ESC の扱いを E2E 受け入れ条件へ固定する。
12. `reconsentConsent()` が必要か、既存 API の再利用で契約を満たせるかを裁定する。
13. 導線追加を `feat`、denial counter reset や通知・状態不整合を `fix` として、後続 PBI の垂直 slice、BDD、テスト順へ分割する。
14. withdraw の意味論または外部バックアップの説明が変わった場合だけ、`PRIVACY_POLICY_VERSION` と2つの `PRIVACY.md` の更新を後続 PBI の完了条件へ含める。

### 落とし穴

- decline 後の文言だけを変更し、実在する再同意導線を追加しないと、案内と実装の不一致が残る。
- Withdraw Consent を撤回済みで hidden にする既存処理を、再同意状態でも同じ destructive action として扱うと、復元と撤回を混同する。
- 再同意を one-click `acceptConsent()` にすると、checkbox、ポリシー確認、`contentStorageEnabled` の明示を省略する。
- 明示 button が 30日抑制を bypass した場合でも、自動 popup の抑制状態を同時に消すと、裁定していない状態変更が発生する。
- 逆に、cooldown bypass を拒否する場合も、「設定画面」という既存案内に対応する実在する再同意経路は 필요하다。
- 3回拒否、30日後の accept、直後の withdraw を確認せず、古い denial timestamp による新しい30日抑制を見落とす。
- combined encrypted backup が DB を復元することから、同意状態と履歴まで復元されたと説明すると、現行の allowlist と一致しない。
- ダウンロード済み Archive、Obsidian markdown、local Markdown が残ることを、撤回後に端末内履歴がすべて消えたと説明する。
- データ削除を承諾状態の変更より先に処理しないと、削除失敗後に同意状態だけ変わる。
- `_locales` を PBI 09 または 10 と並列実装して競合させ、en/ja parity を壊す。
- modal の構造と accessibility だけを確認し、accept、decline、cancel、focus return の実操作をテストしない。
- `reconsentConsent()` が存在しないことを理由に、既存 state API の責務を推測で再定義する。

## 決定事項

### 5 Whys

1. なぜ操作負荷が非対称なのか。dashboard に破壊的な withdraw 導線だけがあり、re-consent 導線がないためである。
2. なぜ popup から dashboard へ戻れないのか。decline 文言だけが設定画面を指示しており、dashboard 実装が追随していないためである。
3. なぜ明示 button があれば解消するのか。modal と同意 state transition API は既にあり、必要なのは明示入口と cooldown override であるためである。
4. なぜ簡単には one-click 化できないのか。`acceptConsent()` は content-storage opt-in も保存し、既存同意履歴を上書きし得るためである。
5. 製品判断が必要なのは何か。withdraw 後も既存履歴保持を許すか、再同意後に backup recovery を促すか、device-local consent を import 対象から完全に除くかである。

### 裁定対象

- 採用する再同意入口を、popup の常時表示バナー、dashboard の re-consent hub、記録停止と撤回・履歴削除の分離の中から確定する。
- 30日抑制を明示操作で bypass するか裁定し、自動表示と明示 override の状態を分離する。
- denial counter reset を 0.5 SP の独立した `fix` として、所有 API、test contract、受影響状態へ割り付ける。
- withdraw 後の既存履歴保持と、同意撤回・履歴削除の分離を裁定する。
- 再同意後の backup recovery 促し方と、device-local consent の import 除外を裁定する。
- 裁定した UX と状態遷移を、後続 `feat` または `fix` の垂直 slice として分割する。

## Definition of Done

- [ ] 3つの UX 案を比較し、採用案または採用組み合わせが特定されている。
- [ ] 拒否済みと撤回済みの両状態から、裁定された再同意入口へ到達できる。
- [ ] 再同意では checkbox とポリシー確認を省略せず、現在の明示同意 modal を再利用する契約が記載されている。
- [ ] popup 自動表示、30日抑制、明示 override、accept、withdraw の状態遷移表が完成している。
- [ ] 明示操作による 30日 bypass の採否と、自動表示の抑制状態の扱いが明記されている。
- [ ] `acceptConsent()` の denial counter reset が 0.5 SP の別 `fix` として切り出されている。
- [ ] 3回拒否、30日後の accept、直後の withdraw で古い拒否履歴が新しい抑制を作らない test contract が後続 `fix` に引き継がれている。
- [ ] withdraw 後の履歴保持と、同意撤回・履歴削除の分離が裁定されている。
- [ ] ダウンロード済み Archive、Obsidian markdown、local Markdown が残る境界が UI と説明にどう反映されるか裁定されている。
- [ ] combined encrypted backup 復元後に同意状態が復元先プロファイルに残ることが反映されている。
- [ ] backup recovery の促し方と device-local consent の import 除外が裁定されている。
- [ ] 新しい文言と button label に `data-i18n` または `getMessage()` を使い、en/ja parity を維持する方針が記載されている。
- [ ] focus trap、keyboard order、`aria-live`、focus return、ESC の扱いが受け入れ条件に含まれている。
- [ ] `clearAllLogs()` の後に `withdrawPrivacyConsent()` を呼び、削除失敗時は同意状態を変えない維持条件が記載されている。
- [ ] 意味論または説明を変更する場合の `PRIVACY_POLICY_VERSION` と2つの `PRIVACY.md` の更新条件が記載されている。
- [ ] 既存 API の再利用か新規 API の導入かが裁定されている。
- [ ] decline 後の再同意、withdraw 後の再同意、30日 bypass、backup restore 後の同意状態を確認する後続 E2E 契約が作成されている。
- [ ] 裁定内容が後続 `feat` または `fix` の垂直 slice、BDD シナリオ、Outside-In テスト順へ変換されている。
- [ ] 本 PBI は調査と裁定に限定し、production code を変更していない。
