# PBI: denied_domains / permission_notify_threshold の単一 writer 化

## ユーザーストーリー

設定利用者として、`permission_notify_threshold` を設定画面で変更した後に、その値が一貫して保存・再読込されるようにする。閲覧履歴を端末固有データとして扱う利用者と、storage キー構造を管理する保守者として、`denied_domains` が設定値、export/import、権限拒否記録のいずれの経路でも意図しない上書きや混在を起こさないようにする。

## ビジネス価値

- 通知設定の変更が保存されない、export/import 後に設定の挙動が変わる、など、二経路管理に起因する不整合を防ぐ。
- 各 storage キーの reader、writer、migration 経路、export/import 上の責務を明確にし、保守時の調査コストと意図しないキー変更を減らす。
- 権限拒否の高頻度記録を維持しながら、設定全体の lock や object CAS に巻き込まれないよう、性能上の退行を防ぐ。
- 単一 writer への統一後は、競合時の動作を定義し、再発防止のテストへ落とし込みやすくする。

## 優先度

- 順位: 18 / 30
- RICEスコア: 1.5（Reach=6 / Impact=1 / Confidence=50% / Effort=2 SP）— 依存（02・17 完了後）で降格

## BDD受け入れシナリオ

```gherkin
Feature: 設定と閲覧履歴の単一 writer 化
  設定値と閲覧履歴を、それぞれの裁定済み writer から一貫して読み書きする。

  Scenario: 通知設定を変更して保存する
    Given 利用者の現在の通知設定が保存されている
    When 利用者が設定画面で permission_notify_threshold を変更して保存する
    Then 裁定済みの単一 writer に新しい値が保存される
    And 他の経路が同じ値へ重複書き込みしない
    And 設定を再読み込んでも変更後の値が保持される

  Scenario: 権限拒否を連続して記録する
    Given 権限拒否を連続して記録する利用状態がある
    When 複数の権限拒否が記録される
    Then 裁定済みの履歴 writer がすべての権限拒否を保存する
    And 通知設定の writer と履歴の writer が競合しない
    And 権限拒否の記録遅延が裁定基準内に収まる

  Scenario: 設定と閲覧履歴を export/import する
    Given denied_domains が閲覧履歴として保存され、通知設定も保存されている
    When 利用者が設定の export/import を行う
    Then export へ含める範囲が裁定済みの契約に従う
    And import によって履歴へ意図しない設定が混入しない
    And 通知設定と端末固有の閲覧履歴の境界が維持される

  Scenario: 移行中に旧 top-level write が到着する
    Given top-level から nested settings への移行が進行中である
    And 旧経路と新経路の書き込みが競合し得る
    When migration と設定保存が同時に実行される
    Then 決定済みの優先順位に従って単一 writer が値を確定する
    And 別経路が同じ値を別々に上書きしない
```

## 受け入れ基準

- [ ] `denied_domains` と `permission_notify_threshold` それぞれについて、reader、writer、migration 経路、export/import 上の責務を所有表へ記録する。
- [ ] `denied_domains` が閲覧履歴か設定かを 5 Whys で裁定し、既存 export へ含めるかどうかと理由を明記する。
- [ ] top-level dedicated key を残す理由を、repository object CAS の回避、独立 quota、履歴保持の候補に分けて検証する。
- [ ] `permission_notify_threshold` の reader と `trustSettings.ts` の direct set を、裁定した単一 writer へ統一する。
- [ ] `denied_domains` を専用 store に残すか、`SettingsRepository` へ統合するかを裁定する。
- [ ] 移行中の旧 top-level write と新経路の write について、優先順位、受理条件、競合後の処理、検証方法を明記する。
- [ ] C16 の object conflict policy が確定するまで、`denied_domains` を nested `settings` へ統合する判断を確定しない。
- [ ] 裁定した writer 以外から対象キーを更新する raw write が残っていないことを、アクセス箇所の棚卸しで確認できる。
- [ ] `src/utils/permissionManager.ts:84-109,288-291` と `src/dashboard/settings/trustSettings.ts:561-568` の各アクセスを、所有表に沿って移行または保持の理由を記録する。
- [ ] `src/utils/storage/defaults.ts:109-110`、`src/utils/storage/types.ts:140-141,382-383`、`src/utils/storage/restorableSettings.ts:41-63` の型付き契約との整合性を確認する。
- [ ] `denied_domains` を高頻度で更新したとき、専用 CAS から全 settings lock や object CAS へ不用意に置き換えていないことを、裁定結果と性能基準で検証する。
- [ ] 後続 `refactor` PBI に、期待動作を示すテスト、既存テストの変更対象、移行順序、ロールバック条件を含める。
- [ ] 実装時は `SettingsRepository` の型付き get/set と delta write 契約（`src/utils/storage/SettingsRepository.ts:181-227`）を使い、cached full snapshot を `setAll()` に渡さない。
- [ ] 既存 storage キー名を変更せず、ESM インポートの `.js` 付与と async/await を維持する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 設定画面で `permission_notify_threshold` を変更し、再読み込み後も保持される最小シナリオを 1 本追加する。
- export/import 後も通知設定が一貫し、`denied_domains` が裁定済みの契約どおり扱われることを確認する。
- 高頻度の権限拒否を含む利用フローで、通知設定と権限拒否履歴がそれぞれの writer へ保存されることを確認する。

### 統合テスト

- `SettingsRepository` の型付き get/set、delta write、optimistic lock までモジュール境界をまたいだ storage 更新を確認する。
- migration 完了前と完了後の top-level write、nested settings write の優先順位を storage fixture で再現する。
- 既存の parity 契約と migration parity テストへ、裁定後の正本となるパスを追加する。
- export/import と `restorableSettings` の契約が一致し、API key の restore 対象契約が変化しないことを確認する。
- `permissionManager` と `trustSettings` が裁定済み writer 以外へ書き込まないことを、spy または fake storage で確認する。

### 単体テスト

- 裁定した `denied_domains` store の read/write/CAS について、正常系、連続更新、競合、migration 中の write を検証する。
- `permission_notify_threshold` の repository read/write と delta 更新を検証する。
- 旧 top-level write が採用、変換、または破棄される各条件を分岐ごとに検証する。
- `denied_domains` を専用 store に残す場合は settings object lock を経由しないこと、nested 化する場合は裁定した object conflict と遅延基準を満たすことを検証する。
- 例外時に部分更新、値の消失、二重書き込みが発生しないことを検証する。

## 実装アプローチ

1. 既存の raw access と型付き契約を所有表へ整理し、key、reader、writer、migration/export の責務を可視化する。
2. 5 Whys により `denied_domains` の責務と export/import 範囲を裁定する。
3. top-level dedicated key を残す候補理由を、object CAS 回避、quota 独立、履歴保持に分けて検証し、確認できない理由を採用しない。
4. `permission_notify_threshold` を `SettingsRepository` の正本となるパスへ寄せ、`denied_domains` は専用 store を維持するか repository へ統合するかを裁定する。
5. migration 中の writer precedence と C16 の object conflict policy の前提を整理する。
6. 裁定後、期待される振る舞いを Outside-In の順でテストへ追加し、最小実装で green にする。
7. 既存テストの pin を新しい契約へ更新し、raw write が裁定済み writer へ収束したことを確認する。
8. 高頻度記録の競合と遅延を検証し、キー構造を変えずに後続 `refactor` PBI を実装可能な状態にする。

## 見積もり

2 SP

## 技術的考慮事項

- `denied_domains` は閲覧履歴として `restorableSettings` から除外されている。nested 化すると settings export に混入し得るため、export/import の裁定前にキー配置を変更しない。
- `permissionManager` の権限拒否記録は高頻度である。専用 CAS を不用意に全 settings lock や object CAS に置換すると、競合と遅延が増える。
- 型付き契約は `SettingsRepository` に存在するため、raw access の統合では型付き getter/setter または delta write を使い、cached full snapshot の `setAll()` は使わない。
- storage キー構造は高リスク領域であり、改名、再配置、二重保存を一時的な回避策として導入しない。
- migration の完了状態と正本となる writer の切替を不明瞭にしない。旧パスを残す場合も、read と write のそれぞれの存続条件を明記する。
- 依存 PBI `pbi/2026-09-25-02-investigate-withlock-cas-deep-equal.md` は、`denied_domains` を `SettingsRepository.set()` へ寄せた場合の `withLock('settings')` と object CAS policy の影響を裁定する。
- 依存 PBI `pbi/2026-09-25-17-fix-settings-migration-completion-state.md` は、top-level から nested settings への移行完了状態を安定させる。
- 実装時は Manifest V3 の storage ライフサイクルに従い、Service Worker のローカル変数へ状態を保持しない。

## 実装者向け注記

### 現状コードの確認

- raw access は 2 ファイル、6 実アクセスサイトである。
- `denied_domains` は、`src/utils/permissionManager.ts:84-109` で top-level `chrome.storage.local` に対する read/write/CAS を行い、対象箇所は `:85,93,103-108` である。
- `permission_notify_threshold` は、`src/utils/permissionManager.ts:288-291` で top-level から読み、`src/dashboard/settings/trustSettings.ts:561-568` で直接 `chrome.storage.local.set` される。
- 型付き契約は `src/utils/storage/defaults.ts:109-110`、`src/utils/storage/types.ts:140-141,382-383`、`src/utils/storage/restorableSettings.ts:41-63` に存在する。
- `denied_domains` は閲覧履歴として `restorableSettings` で意図的に除外されている。
- `src/utils/__tests__/permissionManager.test.ts` は、`denied_domains` の top-level read/write を多数 pin している。確認例は `:193-195,219-220,259-260,454-455,641-642,798-818` である。
- `src/dashboard/settings/__tests__/trustSettings.test.ts:434-437` は threshold の直接 set を検証する。関連テストに `trustSettings-r2.test.ts` と `trustSettings-r3.test.ts` がある。
- migration parity と repository 契約のテストは、`src/utils/storage/__tests__/restorableSettings-spec-table.test.ts`、`restorableSettings.test.ts`、`settingsRepository-migration-parity.test.ts`、`SettingsRepository.test.ts` にある。

### 実装手順

1. 6 実アクセスサイトを reader、writer、migration、export/import に分類し、裁定前の所有表を作成する。
2. `denied_domains` の責務と export/import 範囲について 5 Whys を行い、判定根拠を記録する。
3. top-level dedicated key の存続理由を、object CAS 回避、独立 quota、履歴保持の候補ごとに検証する。
4. `permission_notify_threshold` の reader と writer を `SettingsRepository` へ統一する案を、delta write 契約と migration を含めて評価する。
5. `denied_domains` を専用 store に維持する案と nested `settings` へ統合する案を、C16 完了後に比較する。
6. migration 中の writer precedence、受理後の変換、競合後の破棄条件、二重 writer を止める条件を明記する。
7. 裁定後、まず期待される振る舞いを既存 Jest テストとして追加し、失敗を確認する。
8. canonical writer を実装し、対象テストを green にしてから既存 pin を新しい storage 契約へ更新する。
9. API key の restore 対象外契約、migration parity、裁定済み writer 以外の raw write 不在、権限拒否記録の遅延を検証する。
10. キー構造を変えない実装方針、移行前の値を残すロールバック方法、再開時に二重 write を止める条件を文書化する。
11. 本 PBI は `investigate` として裁定と後続 `refactor` の仕様を確定し、コード変更は後続 `refactor` PBI で実施する。

### 落とし穴

- `denied_domains` を nested settings へ移動すると、高頻度 object CAS が `withLock('settings')` を通り、object conflict の誤検出と遅延が増える。
- 既存テストは top-level write を正として pin しているため、production code だけを直すとテストの期待値と契約が乖離する。
- `permission_notify_threshold` の reader を repository へ移すだけで UI の direct set を残すと、単一 writer 化にならない。
- `denied_domains` のキー変更だけで済ませると、export/import、migration parity、履歴保持の契約が同時に変わる。
- migration 完了前に旧 top-level write と新 nested write の両方を許可すると、二つの writer が再導入される。
- cached full snapshot を `setAll()` へ渡すと、delta write 契約から外れ、意図しない上書きにつながる可能性がある。

## 決定事項

1. **`denied_domains` の責務と export 範囲**  
   5 Whys で、閲覧履歴としての責務と、既存 export へ含めないという意図的除外が妥当かを検証する。責務が閲覧履歴なら、nested settings への取り込みと export 対象化を行わない裁定理由を記録する。

2. **top-level dedicated key を残す根拠**  
   5 Whys で、repository object CAS の回避、独立 quota、権限拒否履歴の保持という候補理由を、コードとテストから確認できるものだけ採用する。確認できない理由を存続根拠にしない。

3. **threshold と denied_domains の writer 分離**  
   `permission_notify_threshold` を `SettingsRepository` へ寄せ、`denied_domains` を専用 history store とする案を第一候補として、object CAS 回避、lock 競合、export 混入、責務の単純さを基準に裁定する。

4. **migration 中の writer precedence**  
   migration 完了後は canonical writer だけを有効にし、旧 top-level write は明示された migration 経路で受理または破棄する。移行前の値を必要とする場合の変換規則と、二重 writer を再導入しない停止条件を明記する。

5. **nested settings への統合条件**  
   C16 の object conflict 裁定と PBI 02 の lock/CAS 評価が完了するまで、`denied_domains` の nested 統合を確定しない。統合する場合は、高頻度更新で object conflict の誤検出と遅延増加が起こらないことを、実測とテストで確かめてから確定する。

## Definition of Done

- [ ] `denied_domains` と `permission_notify_threshold` の reader、writer、migration、export/import を含む所有表が作成されている。
- [ ] 5 Whys の根拠と結論が各決定事項に記録されている。
- [ ] 各キーの単一 writer と、raw write を残す場合はその不可避な理由が確定している。
- [ ] `denied_domains` の export/import 契約が明文化されている。
- [ ] migration 中の writer precedence と C16 object conflict policy への依存関係が明記されている。
- [ ] 高頻度 CAS の競合と遅延について、裁定結果と検証方法が明記されている。
- [ ] 後続 `refactor` PBI に、Outside-In のテスト順、既存テストの変更対象、実装範囲、依存関係、ロールバック方法が含まれている。
- [ ] 既存キー名を変更しない前提、`.js` 付与、async/await、型付き get/set と delta write 契約が後続 PBI の制約に含まれる。
- [ ] `investigate` PBI として調査と裁定が完了し、実装変更は後続 `refactor` PBI に分かれている。
