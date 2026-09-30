# PBI: 設定フィールド validation の descriptor 経路統合

## ユーザーストーリー

保守者として、設定フィールドの validation をテーブル 1 枚に集約したい。なぜなら descriptor テーブルの汎用経路が production で死んでおり、手書き 12 関数が同じ errorId とメタデータを 3 重管理しているからだ。

## ビジネス価値

- `fieldDescriptor.ts` の docstring が主張する「adding a field is one row here with no edits elsewhere」という拡張手順を実際に成立させ、記述と実装の乖離を解消する。
- errorId とクリア条件の単一情報源（SSOT）化により、設定フィールド追加時の編集漏えいを構造的に減らす。
- 未配線の汎用インタプリタ（死んだコード）を判断して廃止または配線し、PBI 2（status メッセージ統一）へ先行できる土台を作る。
- 観測挙動を parity テストで pin することで、pure refactor であることを検証可能な形で示す。

## 優先度

- 種別: refactor
- 順位: 7 / 17
- RICEスコア: 9.0（Reach=5 / Impact=2 / Confidence=90% / Effort=1 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: descriptor テーブル 1 枚で全設定フィールドの blur validation が成立する
  Given descriptor テーブルに 7 行（parse/validate/save/errorId）が定義されている
  And 汎用インタプリタ validateDescriptorField / setupDescriptorValidation はテストからのみ参照されている
  When 設定画面の setup を走らせる
  Then 全 7 フィールドの blur validation が descriptor テーブルの validate を経由して実行される
  And 手書き setup 関数が 1 フィールドずつ個別に登録する経路は残っていない

Scenario: errorId とクリア条件がテーブル SSOT から一意に決まる
  Given 同じフィールドの errorId が descriptor テーブル行・手書きリテラル・クリア射影の 3 箇所に重複記載されている
  When あるフィールドの validation が失敗する
  Then 検証メッセージの errorId と settingsPipeline のクリア対象が同一 descriptor 行から導出されている
  And テーブル行と手書きリテラルが食い違う状態は存在しない

Scenario: refactor 前後も表示・タイミング・クリア条件が観測挙動として不変である
  Given 7 フィールドそれぞれについて、invalid 入力時の表示文言・表示タイミング・クリア条件の baseline を記録した
  When 手書き validator を descriptor 経由の 1 ループへ置換する
  Then 各フィールドの表示文言、表示タイミング、クリア条件が baseline と一致する
  And 未翻訳キーの解決結果が空文字である表示契約が維持される

Scenario: 複合 validator と cross-field 文脈を持つフィールドがテーブル経由で正しく判定される
  Given validateMaxTokens は providerId を引数に取る
  And validateObsidianHost は scheme + host + port の複合判定である
  When descriptor 経由の validation を実行する
  Then providerId に依存する判定と複合判定が置換前の結果と一致する
  And 複合 validator は descriptor の validate に関数参照として保持されている
```

## 受け入れ基準

- [x] descriptor テーブル（`fieldDescriptor.ts:142-199`）の 7 行が parse / validate / save / errorId の SSOT として全 production 経路から参照され、手書き errorId リテラル（`fieldValidation.ts:94` 等の 7 箇所）が 0 箇所になっている。
- [x] 汎用インタプリタ（`fieldValidation.ts:337-363`、`:369`）が production 参照 0 件の状態を解消し、配線するか削除するかを決断している。
- [x] `validateAllFields`（`fieldValidation.ts:412-428`）と手書き setup 7 個（`:203-323`）が descriptor テーブルを 1 ループで走査する実装に置き換わっている。
- [x] 手書き validator 本体（`validateProtocol :90` / `validatePort :114` / `validateMinVisitDuration :130` / `validateMinScrollDepth :145` / `validateMaxTokens :251` / `validateObsidianHost :280` / `validateGeminiApiVersion :296`）の判定ロジックが descriptor の validate に集約されている。
- [x] クリア用射影（`settingsPipeline.ts:31-36`）がテーブル SSOT から導出され、3 重管理が解消されている。
- [x] メッセージ解決は現行の `getMessage`（`src/dashboard/settings/i18n.ts:38`、未翻訳なら `""`）を正とし、汎用側の `getMessageOr(errorKey, errorKey)`（`fieldValidation.ts:344`、キー名をそのまま表示）へ寄せた表示契約変更が発生していない。
- [x] 7 フィールドについて invalid 入力時の表示文言・表示タイミング・クリア条件を pin する parity テストが存在し、既存テストの pin 更新が必要か確認して反映している。
- [x] 既存のビルド、テスト、ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 設定画面を開き、各 7 フィールドへ invalid 値を入れて blur し、表示文言・表示位置・表示の消え方が refactor 前 baseline と一致することを確認する。
- エラー表示後に値を修正して再 blur したとき、エラーがクリアされる条件（どの操作で消えるか）が baseline と一致することを確認する。
- protocol / port / minVisitDuration / minScrollDepth / maxTokens / obsidianHost / geminiApiVersion の 7 系統すべてを確認する。
- 新しいユーザー機能は追加せず、「既存 7 フィールドの validation 挙動が不変である」ことを Outside-In の観測点とする。

### 統合テスト

- `settingsPipeline.ts:95` から `validateAllFields` までの一連の流れが descriptor テーブルだけを唯一の入力とすることを確認する。
- descriptor テーブル → validation → クリア射影（`settingsPipeline.ts:31-36`）の経路で errorId が一致し、手書きリテラルを 1 箇所でも参照しないことを確認する。
- 汎用インタプリタを配線した場合、`validateDescriptorField` / `setupDescriptorValidation` / `validateAllDescriptorFields` の production 参照が 0 でなくなることを確認する。削除した場合は参照 0 を維持する。
- `src/dashboard/settings/i18n.ts` 経由で解決されるメッセージが空文字となる未翻訳キーの扱いが従来と一致することを確認する。

### 単体テスト

- descriptor テーブル各行の parse / validate / save について、代表値（境界値・空・不正形式）を table-driven に検証する。
- `validateMaxTokens` について providerId の値によって判定が変わる組み合わせを検証する。
- `validateObsidianHost` について scheme / host / port の組み合わせ（http/https、host 空、port 空、port 範囲外）を検証する。
- parity テストとして、7 フィールド × invalid 入力 × 表示文言・表示タイミング・クリア条件を pin する。現状この層に pin が存在しないため新設が要る。

## 実装アプローチ

- **Outside-In**: まず parity テスト（7 フィールドの表示文言・表示タイミング・クリア条件の pin）を Red として書き、既存の観測挙動を固定してから内部構造の変更に入る。
- **Red-Green-Refactor**: descriptor 経由の 1 ループに置き換えた直後、parity テストが緑のまま `npm run validate` を通すことを確認してから、クリア射影の SSOT 化を別段階で行う。
- **判定ロジックの移動と配線は分離**: 先に手書き validator の本体を descriptor の validate へ移し（配線の意味では挙動不変）、次に validation 呼び出しを descriptor 経由のループへ置換する。
- **死んだ汎用インタプリタの明示的判断**: Factsheet 上 production 参照 0 のため、配線せず削除する判断と、配線してテーブルを唯一の入口にする判断のどちらかを着手時に 1 度だけ決め、docstring（`fieldValidation.ts:333`）の記述を実態に合わせる。
- **docstring と実態の同期**: `fieldDescriptor.ts:9` と `fieldValidation.ts:333` の「テーブル 1 行追加で済む」主張が refactor 後に真になるかを確認する。真にならない場合は記述を弱める。
- **過剰な抽象化の回避**: 複合 validator（`validateObsidianHost`）をテーブルの構造で無理に一般化せず、関数参照として保持する現実解を採る。

## 見積もり

**1 SP**

手書き setup 7 個のループ化（`fieldValidation.ts:203-323`）、`validateAllFields`（`:412-428`）のテーブル化、判定ロジックの descriptor への移動、errorId 射影（`settingsPipeline.ts:31-36`）の SSOT 化、死んだインタプリタの判断、parity テスト新設を含む。1 フィールド 1 行の前提が崩れる複合 validator が 1 件（`validateObsidianHost :280`）、cross-field 引数を持つ validator が 1 件（`validateMaxTokens :251`）あるため、純粋なループ置換ではない点が上振れ要因となる。

## 技術的考慮事項

- descriptor テーブルは `src/dashboard/settings/fieldDescriptor.ts:142-199` の 7 行（parse / validate / save / errorId）であり、これを SSOT とする。
- 汎用インタプリタ `validateDescriptorField` / `setupDescriptorValidation` は `src/dashboard/settings/fieldValidation.ts:337-363`、`validateAllDescriptorFields` は `:369` にあるが production 参照 0 件で、テストからのみ参照されている。
- `fieldValidation.ts:333` の docstring は「New table rows get blur-validation via setupDescriptorValidation」と主張するが、実態は未配線である。記述と実態の乖離自体が本 PBI の指摘対象。
- 実経路は `settingsPipeline.ts:95` → `validateAllFields`（`fieldValidation.ts:412-428`）であり、ここが置き換わるループの入口になる。
- 手書き validator のリテラル errorId は `fieldValidation.ts:94` / `:118` / `:133` / `:148` / `:256` / `:284` / `:299` の 7 箇所。
- クリア用射影は `settingsPipeline.ts:31-36`。ここを descriptor SSOT 起点にしないと errorId は 3 重管理のまま残る。
- メッセージ解決の規約が 2 系統ある。手書き側は `getMessage('errorProtocol')`（`src/dashboard/settings/i18n.ts:38`、未翻訳なら `""` を返す）、汎用側は `getMessageOr(errorKey, errorKey)`（`fieldValidation.ts:344`、キー名を出力）。統合時に現行の `""` 返しを正とする表示契約を選ぶこと。
- `validateMaxTokens`（`fieldValidation.ts:251`）は providerId を引数に取るため、descriptor の validate は 1 フィールド 1 行の単純関数を前提にせず、入力文脈を受け取れる形にしておく必要がある。
- `validateObsidianHost`（`fieldValidation.ts:280`）は scheme + host + port の複合判定で、1 フィールド 1 行という前提が崩れる。テーブルの validate に関数参照として保持する現実解を採る。
- 本 PBI は `settingsPipeline.ts` を変更するため、PBI 2（`2026-09-28-15-refactor-status-message-unification`）とファイルが重複する。07 を先に完了させる。

## 実装者向け注記

### 現状コードの確認

- テーブルは `src/dashboard/settings/fieldDescriptor.ts:142-199` の 7 行。docstring（`:9`）は「adding a field is one row here with no edits elsewhere」と主張している。
- 汎用インタプリタは `src/dashboard/settings/fieldValidation.ts:337-363`（`validateDescriptorField` / `setupDescriptorValidation`）と `:369`（`validateAllDescriptorFields`）。production 参照 0 件でテストからのみ参照される。
- production の実経路は `src/dashboard/settingsPipeline.ts:95` → `validateAllFields`（`fieldValidation.ts:412-428`）。
- 手書き setup が 7 個ある（`fieldValidation.ts:203-323`）。手書き validator 本体は `validateProtocol :90` / `validatePort :114` / `validateMinVisitDuration :130` / `validateMinScrollDepth :145` / `validateMaxTokens :251` / `validateObsidianHost :280` / `validateGeminiApiVersion :296`。
- errorId は 3 箇所に重複している: テーブル行（`fieldDescriptor.ts:146` 等）、手書きリテラル（`fieldValidation.ts:94` / `:118` / `:133` / `:148` / `:256` / `:284` / `:299`）、クリア用射影（`settingsPipeline.ts:31-36`）。
- メッセージ解決は不統一: `getMessage`（`src/dashboard/settings/i18n.ts:38`）は未翻訳なら `""`、`getMessageOr`（`fieldValidation.ts:344`）はキー名を返す。

### 実装手順

1. 7 フィールドについて invalid 入力時の表示文言・表示タイミング・クリア条件を記録し、parity テストを Red として追加する。
2. 手書き validator の判定ロジックを descriptor の validate へ移す（この段階では呼び出し経路は変更しない）。`validateMaxTokens` の providerId と `validateObsidianHost` の複合入力をここで解決する。
3. 手書きリテラル errorId（`fieldValidation.ts:94` 等の 7 箇所）をテーブル行から導出する形に置き換え、手書きリテラルが 0 箇所になることを確認する。
4. `validateAllFields`（`fieldValidation.ts:412-428`）を descriptor テーブルを 1 ループで走査する実装に置き換える。
5. 手書き setup 7 個（`fieldValidation.ts:203-323`）を同じ 1 ループに置き換える。
6. 汎用インタプリタ（`:337-363`、`:369`）について、配線するか削除するかを決め、決定に従ってテスト参照と docstring（`:333`）を同期する。
7. `settingsPipeline.ts:31-36` のクリア射影をテーブル SSOT から導出する形に更新する。
8. parity テストが緑、`npm run validate` が成功することを確認する。
9. メッセージ解決が `getMessage`（`i18n.ts:38`、未翻訳なら `""`）の契約に統一されていることを確認する。

### 落とし穴

- `validateMaxTokens` は providerId を引数に取るため、descriptor に 1 フィールド 1 関数を単純に押し込むと文脈が失われる。cross-field 文脈の渡し方（引数・クロージャ・入力オブジェクト）を着手時に決める。
- `validateObsidianHost` は scheme + host + port の複合判定であり、1 フィールド 1 行の前提が崩れる。テーブルの構造を一般化すると逆にテーブルが複雑になるため、validate に関数参照として保持する現実解を採る。
- `settingsPipeline.ts:31-36` のクリア射影の更新を忘れると、errorId はテーブル側だけが SSOT になり 3 重管理が残ったまま「統合済み」に見える。
- 汎用インタプリタを配線せずに放置すると、死んだコードと錯綜した docstring のまま残り、次に読む人を誤誘導し続ける。配線か削除かの判断を明文化しないまま進めない。
- メッセージ解決を汎用側（`getMessageOr`）へ寄せると、未翻訳キーで「errorProtocol」というキー名がそのまま画面に出る。表示挙動の変化になるため `getMessage`（`""` 返し）を正とする。
- parity テストを書かずに置換すると、表示文言・表示タイミング・クリア条件の変更が refactor に紛れて検出されない。
- 手書き errorId リテラルを 1 箇所でも残すと、以降テーブルを編集しても表示が追従しない。残存チェックを完了基準に含める。
- PBI 2 と `settingsPipeline.ts` を同時に変更すると、統合時に変更意図が衝突する。07 を先に完了させる。

## 決定事項

1. 手書き 12 関数が同じ errorId とメタデータを 3 重管理している理由は、descriptor テーブルの汎用経路が production で使われていないためである（`fieldValidation.ts:337-363`、`:369` の production 参照 0 件）。
2. 汎用インタプリタはテストからのみ参照されており、production の実経路は `settingsPipeline.ts:95` → `validateAllFields`（`fieldValidation.ts:412-428`）→ 手書き setup 7 個（`:203-323`）である。
3. errorId の SSOT は descriptor テーブル（`fieldDescriptor.ts:142-199`）とし、手書きリテラル（`fieldValidation.ts:94` 等の 7 箇所）とクリア射影（`settingsPipeline.ts:31-36`）はテーブルから導出する。
4. メッセージ解決は現行の `getMessage`（`src/dashboard/settings/i18n.ts:38`、未翻訳なら `""`）を正とし、汎用側の `getMessageOr(errorKey, errorKey)`（`fieldValidation.ts:344`）表示には寄せない。
5. `validateAllFields` と setup 系は descriptor テーブルを 1 ループで走査する実装に置き換える。
6. 複合 validator（`validateObsidianHost :280`）と cross-field 引数を取る validator（`validateMaxTokens :251`）は、判定ロジックを descriptor の validate へ移したうえで、1 フィールド 1 関数の前提を崩さず関数参照として保持する。
7. 汎用インタプリタ（`:337-363`、`:369`）は、配線してテーブルの唯一の入口にするか削除するかを着手時に 1 度だけ決め、docstring（`:333`）と `fieldDescriptor.ts:9` の記述を実態に同期する。
8. 本 PBI は pure refactor であり、観測挙動（表示・表示タイミング・クリア条件）は変更しない。維持は parity テストで pin する。
9. PBI 2（`2026-09-28-15-refactor-status-message-unification`）と `settingsPipeline.ts` が重複するため、本 PBI を先に完了させる。

## Definition of Done

- [x] descriptor テーブル（`fieldDescriptor.ts:142-199`）の 7 行が全 production 経路の唯一の SSOT として参照され、手書き errorId リテラル（`fieldValidation.ts:94` / `:118` / `:133` / `:148` / `:256` / `:284` / `:299`）が 0 箇所になっている。
- [x] クリア射影（`settingsPipeline.ts:31-36`）がテーブル SSOT から導出され、3 重管理が解消されている。
- [x] `validateAllFields`（`fieldValidation.ts:412-428`）と手書き setup 7 個（`:203-323`）が descriptor テーブルを 1 ループで走査する実装に置き換わっている。
- [x] 汎用インタプリタ（`:337-363`、`:369`）の配線または削除が判断済みで、production 参照 0 件の状態が解消または維持として記録され、docstring（`fieldDescriptor.ts:9`、`fieldValidation.ts:333`）が実態と一致している。
- [x] メッセージ解決が `getMessage`（`src/dashboard/settings/i18n.ts:38`）の未翻訳 `""` 契約を維持している。
- [x] 7 フィールドについて表示文言・表示タイミング・クリア条件を pin する parity テストが存在し green である。
- [x] `validateMaxTokens`（`:251`）の providerId と `validateObsidianHost`（`:280`）の複合判定が置換前と一致する（結果 parity）。
- [x] 既存テストのうち descriptor 経路を前提にしていた箇所の pin 更新が必要か確認し、反映している。
- [x] refactor 前後の観測挙動（表示・表示タイミング・クリア条件）が不変であることを parity テストで示している。byte-identical でなくても観測挙動不変でよい。
- [x] `npm run validate` が成功し、既存のビルド、テスト、ユーザーに観測される動作に回帰がなく、コードレビューが完了している。
