# PBI: 非推奨エイリアスと互換 shim の sunset 基準確立

種別: investigate（分類調査 → 既存ガードを拡張する `refactor` へ接続）

## ユーザーストーリー

削除判断の先送りを止めたい保守者として、production source にある非推奨エイリアスと互換 shim を internal shim、移行中、外部互換の 3 種に分類し、削除、期限付き維持、据え置きの裁定基準を望む。deprecation metadata の SSOT、consumer の有無、owner、契約を一度に可視化することで、保護機構の意図が読めない状態を解消し、後続の `refactor` が安全に既存ガードへ接続できるようにする。

## ビジネス価値

- 日付のない 34 個の `@deprecated` tag を、到達可能な互換負債として明示的に管理対象にする。
- 削除、期限付き維持、据え置きの判断基準と再確認条件を先に定め、毎年の先送りを止める。
- 内部利用だけと確認できない shim を、外部 consumer の有無を確認せずに削除しない。
- `storage.ts` の内部互換 export、crypto / HMAC 系 shim、grandfathered import の参照関係を調査し、後続 `refactor` の変更範囲を絞る。
- 既存の `check-deprecated-aliases` を拡張する方針を定め、別々の gate を増やさない。

## 優先度

- 種別: investigate
- 順位: 23 / 30
- RICEスコア: 0.53（Reach=2 / Impact=0.5 / Confidence=80% / Effort=1.5 SP）
- 依存関係: `pbi/2026-09-25-14-refactor-ci-paths-filter.md`（`scripts/check-deprecated-aliases.mjs` と対象 source を `validate` の起動対象へ含める必要がある）

## BDD受け入れシナリオ

```gherkin
Feature: 非推奨エイリアスと互換 shim の sunset 基準を確定する

  Scenario: 全 tag を分類可能な状態にする
    Given production source 全体に 38 個の @deprecated tag が 17 ファイルに存在する
    And そのうち 4 個だけに Sunset: の日付があり、残り 34 個には日付がない
    When 保守者が tag ごとの参照、consumer、owner、契約を確認する
    Then すべての tag とファイルが internal shim、移行中、外部互換のいずれかへ分類される
    And 各分類に判定根拠と次の確認条件が記録される
    And 17 ファイル、38 tag、Sunset あり 4 tag の数が一致する
    And 日付がない tag も、削除、期限付き維持、据え置きのいずれかを検討できる状態になる

  Scenario: 外部 consumer の証明なしに日付だけを追加しない
    Given ある内部 shim について外部 consumer が無いことをまだ証明できない
    When 保守者が sunset 基準または削除条件を裁定する
    Then 外部 consumer の有無を確認するための参照調査が残る
    And 確認前の tag へ日付だけを追加しない
    And 確認前の shim を削除しない
    And 未確認の項目は据え置きまたは追加調査として明示される

  Scenario: 既存ガードを全 production tag へ広げられる
    Given 既存スクリプトが ProviderStrategy と OpenAIProvider の 2 rules だけを監視している
    And その 2 rules には 2026-12-31 の再評価日が記載されている
    When 後続 refactor の guard 作用域を定義する
    Then production source 全体の 38 tag に対して検査範囲を定義できる
    And 既存 2 rules と 2026-12-31 の再評価日が保持される
    And script の unit test、日付 parser、全 @deprecated の網羅性 test、scope 拡大検査を定義できる
    And 新しい gate を増やさず、既存ガードを release-check orchestrator と validate に接続する

  Scenario: storage と crypto / HMAC の参照を混同せず裁定する
    Given src/utils/storage.ts に 15 個の内部互換 export があり
    And crypto 系にも shim があり、grandfathered import は 10 production ファイルにある
    When 保守者が shim の利用箇所と移行条件を調査する
    Then storage の内部参照、background import、既存 alert や fix と共有する経路を確認する
    And crypto / HMAC 系 shim は利用箇所の確認前に削除しない
    And 各 shim の owner、内部または外部契約、再確認日、削除条件を記録する
```

## 受け入れ基準

- [ ] production source の 38 tag / 17 ファイルを一覧化し、4 tag / 4 ファイルの `Sunset:` と 34 tag の日付なし状態を突合している。
- [ ] 各 tag に internal shim、移行中、外部互換の一次分類と、分類の根拠となる参照・契約・consumer 情報を記録している。
- [ ] 削除、期限付き維持、据え置きのそれぞれについて、適用条件、再確認条件、削除条件を記録している。
- [ ] 各 17 ファイルについて、owner、内部で守る契約、外部で守る契約の有無、下限の見直し日、削除条件を記録している。確認できない項目は未確認として残す。
- [ ] 内部 shim に外部 consumer が無いことを証明できない限り、日付の付与と削除の裁定を確定しない。
- [ ] crypto / HMAC 系 shim は、利用箇所と移行条件を確認するまで削除対象に確定しない。
- [ ] `src/utils/storage.ts:26-141` の 15 個の内部互換 export について、内部参照、background import、既存 alert や fix と共有する storage 経路を確認する。
- [ ] grandfathered import 10 production ファイルを、shim の consumer 調査に含める。
- [ ] deprecation metadata の SSOT、保管形式、`Sunset:` と再評価日の関係を定義し、自由 format のまま放置しない。
- [ ] `scripts/check-deprecated-aliases.mjs:21-25` の既存 2 rules と 2026-12-31 の再評価日を保持したまま、全 production `@deprecated` を検査範囲へ広げる検査を後続 `refactor` に引き継ぐ。
- [ ] script 自体の unit test、日付 parser の test、`@deprecated` 全体の網羅性 test、scope 拡大検査のテスト範囲を定義する。
- [ ] scripts の新規検査を追加する場合は `scripts/release-checks/index.mjs:32-42` の登録方式に合わせ、既存ガードの `validate` への組込みを優先する。gate を分散させない。
- [ ] `npm run validate` と `.github/workflows/ci.yml:42-45` で `check-deprecated-aliases` が実行される現状を前提に、依存 PBI 14 と接続する。
- [ ] コメントには有効期限と移行条件だけを書き、履歴や PBI task ID を書かない。
- [ ] 本 PBI は分類調査と裁定基準の確定に限定し、production code の変更や shim 削除を行わない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 本 PBI は調査と裁定基準の確定に限定するため、production の挙動を変更する E2E テストは追加しない。
- 後続 `refactor` では、production source に新しい `@deprecated` が追加されたとき、既存ガードが定義された scope の外へ漏れないことを Outside-In で確認する。
- 後続 `refactor` では、分類・期限 parser の裁定変更が `validate` と `release:check` の両方で同じ結果になることを統合的な gate 実行として確認する。
- 削除・期限付き維持・据え置きの各裁定は、実行時の挙動を変更しない調査成果物として E2E 対象から分離する。

### 統合テスト

- `scripts/check-deprecated-aliases.mjs` を production source 全体へ実行し、38 tag / 17 ファイル、4 個の `Sunset:`、34 個の未記載日数を突合する。
- `validate` と release-check orchestrator が同じ既存ガードを起動し、別の検査スクリプトや別の gate を追加しないことを確認する。
- 依存 PBI 14 で `scripts/check-deprecated-aliases.mjs` と対象 source が `validate` の起動対象へ含まれる接続を確認する。
- `storage.ts` の内部互換 export、crypto / HMAC 系 shim、background import、grandfathered import 10 production ファイルを、consumer 調査用の fixture としてまとめる。
- 日付付き metadata、日付なし metadata、scope 外的 tag、既存 2 rules の 2026-12-31 再評価日の混在を同じ検査へ通す。
- 既存の `.github/workflows/ci.yml:42-45` による `check-deprecated-aliases` 実行を維持する。

### 単体テスト

- script の unit test を追加し、既存 2 rules の照合と全 production tag の列挙を確認する。
- 日付 parser の正常値、日付なし、形式不正、境界値を、裁定した契約どおりに扱う。
- `@deprecated` 全体の網羅性 test で、検査対象から production tag が漏れないことを確認する。
- scope 拡大検査で、監視対象外の tag を追加したときの検出と、既存 source path の変更時の扱いを固定する。
- internal shim、移行中、外部互換の分類と、削除・期限付き維持・据え置き判定の入力を単体で検証する。
- 既存の 2 rules と 2026-12-31 の再評価日が、拡張後も同じ結果になることを固定する。

## 実装アプローチ

1. 依存関係 `pbi/2026-09-25-14-refactor-ci-paths-filter.md` の完了条件と、`scripts/check-deprecated-aliases.mjs` および対象 source の `validate` 起動対象への接続を確認する。
2. production source 全体の 38 tag / 17 ファイル、`Sunset:` あり 4 tag、未記載 34 tag を一覧化し、既存 2 rules と一致させる。
3. 各 tag について production import、background import、storage 経路、grandfathered import、外部参照を調査する。
4. `src/utils/storage.ts:26-141` の 15 個の内部互換 export と crypto / HMAC 系 shim を分け、各 owner、契約、利用箇所、移行条件を記録する。
5. 5 Whys を通じて、日付がない shim の原因、自動期限にならない原因、一括対応のリスク、放置コスト、各ファイルの確定条件を整理する。
6. internal shim、移行中、外部互換の分類基準と、削除、期限付き維持、据え置きの裁定基準を1つの表にする。
7. deprecation metadata の SSOT と parser 契約を決め、既存 2 rules と 2026-12-31 の再評価日を壊さない guard 拡張の仕様とテストを定義する。
8. 新規検査を増設せずに、`scripts/release-checks/index.mjs:32-42` に沿って既存ガードへ接続する後続 `refactor` の変更範囲を確定する。
9. 本 PBI では production code を変更せず、分類表、裁定基準、参照証拠、owner 表、テスト戦略を後続 `refactor` の入力として引き継ぐ。

## 見積もり

1.5 SP（分類調査と裁定基準の確定まで。既存ガードの実装、parser、分類の強制適用、shim 削除は後続 `refactor` の範囲）

## 技術的考慮事項

- production source 全体には 38 個の `@deprecated` が 17 ファイルにあり、`Sunset:` は 4 個 / 4 ファイルだけである。日付の記載数を scope の根拠にしない。
- 既存 script が監視するのは `ProviderStrategy` と `OpenAIProvider` の 2 rules だけである。全 tag へ広げる際に、既存の 2 rules と 2026-12-31 の再評価日を保持する。
- deprecation metadata は自由 format かつ SSOT がないため、後から検索・parser・scope 判定できる形式を裁定する。
- 内部 shim の外部 consumer 不在を、production import の不在だけから推定しない。crypto / HMAC 系 shim は参照調査なしに削除しない。
- `src/utils/storage.ts:26-141` には 15 個の内部互換 export があり、background import や既存 alert / fix と storage 経路を共有する場合があるため、shim 単位の単純な削除は行わない。
- grandfathered import は 10 production ファイルに存在するため、「grandfathered」という理由だけで consumer なしとしない。
- scripts の新規検査は既存ガードの `validate` への組込みを優先し、`scripts/release-checks/index.mjs:32-42` の登録方式に合わせる。gate を分散させない。
- `npm run validate` と `.github/workflows/ci.yml:42-45` の既存 gate を前提にし、最終確認は `npm run validate` と `npm run release:check` で行う。
- コメントには有効期限と移行条件だけを書く。履歴や PBI task ID をコードコメントへ残さない。
- 本 PBI の成果は裁定とテスト仕様であり、production 参照を壊す削除操作を含めない。

## 実装者向け注記

### 現状コードの確認

- `scripts/check-deprecated-aliases.mjs:21-25` は `ProviderStrategy` と `OpenAIProvider` の 2 rules だけを監視している。
- `src/background/ai/providers/ProviderStrategy.ts:582-589` と `src/background/ai/providers/OpenAIProvider.ts:278-283` には、2026-12-31 の再評価日が記載されている。
- production source 全体で `@deprecated` は 38 tags / 17 ファイルに存在する。
- `Sunset:` があるのは 4 tags / 4 ファイルで、34 tags には日付がない。
- `src/utils/storage.ts:26-141` には 15 個の内部互換 export がある。
- `src/utils/crypto` 系にも shim がある。
- grandfathered import は 10 production ファイルに存在する。
- `npm run validate` は `package.json:42-50` に定義され、`.github/workflows/ci.yml:42-45` で `check-deprecated-aliases` が実行される。
- `scripts/release-checks/index.mjs:32-42` が scripts の登録方式である。
- script 自体の unit test、日付 parser、`@deprecated` 全体の網羅性 test、scope 拡大検査は存在しない。

### 実装手順

1. 依存 PBI 14 の接続条件を確認する。
2. 38 tag / 17 ファイルの inventory を作り、4 tag の `Sunset:` と 34 tag の日付なしを突合する。
3. 各 tag の参照元、consumer、owner、内部・外部契約、下限の見直し日、削除条件を調査表へ記録する。
4. storage の 15 内部 export、crypto / HMAC 系 shim、10 grandfathered import を、production 参照と移行 bridge ごとに分類する。
5. 5 Whys の回答を、分類基準と裁定基準へ変換する。
6. metadata SSOT、parser の異常入力、既存 2 rules の保持方針を定義する。
7. 既存ガードを全 production tag へ広げる unit、parser、網羅性、scope 拡大検査と、validate / release:check への接続を後続 `refactor` の仕様に落とす。
8. 本 PBI の成果物を後続 `refactor` の垂直 slice へ接続する。production code と shim の削除は別 PBI で実施する。

### 落とし穴

- 日付を付けるだけで外部 consumer がない証明を省略すると、production 参照を壊す。
- crypto / HMAC 系 shim の利用箇所を確認せずに削除すると、background import や既存 fix の経路を壊し得る。
- grandfathered import を consumer なしと決めつけると、production 参照を見落とす。
- 17 ファイルすべてを同じ分類にまとめると、内部 shim、移行中、外部互換の契約の違いを消してしまう。
- 既存 script の 2 rules だけを残したまま全 tag へ日付を求めると、scope の穴が残る。
- 新しい検査 script と別の gate を追加すると、`validate` と release-check の判定が分散する。
- `storage.ts` の export を孤立した shim とみなすと、background import、既存 alert / fix と共有する storage 経路を見落とす。
- コメントに履歴や PBI task ID を書くと、guard の裁定条件と無関係な情報が実装へ固定される。

## 決定事項

5 Whys の結果として、次の裁定方針を本 PBI の調査成果物へ固定する。

1. **なぜ期限がない shim があるか**  
   `@deprecated` の広範な採用と、当初 script guard の対象が 2 件に限定されたためである。全 production tag を scope に含めるが、日付の機械的付与は消費者確認後に行う。

2. **なぜ自動期限にならないのか**  
   deprecation metadata の自由 format と SSOT の不在、consumer 有無の判定がないためである。metadata の SSOT と parser、consumer 確認の契約を後続 `refactor` の入力として定義する。

3. **なぜ一括対応が危ないか**  
   内部テスト互換、migration bridge、外部相当性が混在するためである。internal shim、移行中、外部互換を分類し、削除、期限付き維持、据え置きを条件付きで裁定する。

4. **放置コストは何か**  
   34 tags が到達可能な互換負債として残り、削除判断が毎年の先送りになるためである。各 tag の裁定結果を未完了項目として可視化し、後続 `refactor` の対象にする。

5. **17 ファイルそれぞれで何を決めるか**  
   owner、内部と外部の契約、下限の見直し日、削除条件をファイルごとに記録する。確認できない項目は日付を確定させず、未確認理由と次の調査条件を裁定する。

裁定成果物には、38 tag / 17 ファイルの inventory、3 分類の判定表、削除・期限付き維持・据え置きの条件、ファイルごとの owner と契約と再確認日と削除条件、consumer 証拠、metadata SSOT、parser 契約、既存 guard の scope 拡大、既存 2 rules の保持、後続 `refactor` の変更範囲を含める。

## Definition of Done

- [ ] 38 tag / 17 ファイルの一覧と、4 個の `Sunset:`、34 個の未記載 tag の突合が完了している。
- [ ] 全 tag が internal shim、移行中、外部互換のいずれかへ分類され、判定根拠が記録されている。
- [ ] 削除、期限付き維持、据え置きの裁定基準と、再確認条件、削除条件が記録されている。
- [ ] 17 ファイルそれぞれについて owner、内部・外部契約、下限の見直し日、削除条件が記録され、未確認項目が明示されている。
- [ ] 内部 shim の外部 consumer 不在は、証明できる参照調査だけを根拠に判定されている。
- [ ] crypto / HMAC 系 shim と `storage.ts` の 15 内部互換 export について、利用箇所と移行条件が調査されている。
- [ ] grandfathered import 10 production ファイルが consumer 調査に含まれている。
- [ ] deprecation metadata の SSOT と parser 契約が定義され、自由 format の SSOT 不在が解消される後続仕様になっている。
- [ ] `scripts/check-deprecated-aliases.mjs` の既存 2 rules と 2026-12-31 の再評価日を保持した全 production scope の guard 仕様になっている。
- [ ] script unit test、日付 parser、`@deprecated` 全体の網羅性 test、scope 拡大検査が後続テスト戦略に含まれる。
- [ ] 既存ガードの `validate` への組込みと `scripts/release-checks/index.mjs:32-42` の登録方式に合わせ、gate を分散させない。
- [ ] コードコメントには有効期限と移行条件だけを書き、履歴や PBI task ID を残さない。
- [ ] 本 PBI は production code を変更せず、shim を削除せず、後続 `refactor` の垂直 slice とテスト範囲を接続している。
- [ ] 最終確認として `npm run validate` と `npm run release:check` を確認する手順が後続実装に引き継がれている。
