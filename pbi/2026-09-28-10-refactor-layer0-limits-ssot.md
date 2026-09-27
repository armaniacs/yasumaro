# PBI: Layer 0 cap 定数の SSOT 化

## ユーザーストーリー

保守者として、Layer 0 の cap 定数を `src/utils/limits.ts` に集約したい。なぜなら `src/messaging/limits.ts` が自ファイル内で `@layer 0` を自称しながら `src/utils` 外に配置され、layer lint に穴があるため Layer 0 からの違反 import が見逃されているからだ。

## ビジネス価値

- 自己申告の layer 注釈と物理配置の不一致を解消し、Layer 0 の定義（`src/utils` 配下の純粋モジュール）を単一の基準に戻す。
- layer lint の未分類バイパス（Layer 0 ファイルから `src/messaging/*` への import が検査対象にすらならない）を塞ぎ、同一の穴が再発しないようにする。
- background の pipeline が ingress validator モジュールに依存している逆方向の依存を解消する。現状は 4 つの cap 定数を取得するためだけに 321 行の background モジュールが transitive に引き込まれる。
- `QUERY_CAPS` の re-export kludge（実質的には文脈依存の誤り）と、その根拠を説明するコメントの driftを解消する。
- PBI `2026-09-28-14`（messaging 逆辺解消）が扱わない定数領域を先に片付けることで、14 の対象範囲を messaging の実行時依存に限定する。

## 優先度（refactor / 順位 10 / 17 / RICEスコア 5.3（Reach=4 / Impact=2 / Confidence=100% / Effort=1.5 SP））

## BDD受け入れシナリオ（gherkin、Scenario 2件以上）

```gherkin
Scenario: Layer 0 の cap 定数が単一モジュールに集約されている
  Given messaging 領域の cap 定数が messaging 配下のモジュールから 21 ファイルに import されている
  And 4 つの validator cap 定数が messaging の validators モジュールから background の pipeline で取得されている
  When cap 定数の配置と import を確認する
  Then すべての cap 定数が Layer 0 の utils 配下モジュールに定義されている
  And 旧パスからの import は移行済みの新規 import に置き換わっている
  And 定数の値、名前、export の形は変更されていない

Scenario: Layer 0 から messaging への違反 import が lint で検出される
  Given Layer 0 として登録された utils 配下のモジュールが messaging 配下のモジュールを import する
  When リポジトリ全体で lint を実行する
  Then その import が error として報告され、allowlist のない変更は CI を通過しない
  And 移行用の一時 shim からの re-export は、過渡措置として明示された例外としてのみ通る

Scenario: メッセージ契約と値が変わらない
  Given 本 PBI の適用前後で同じ extent 検証メッセージと row cap を持つ
  When 受信メッセージの検証を実行する
  Then 検証結果と表示メッセージが同一である
  And 保持される行数とバイト数の制限値が同一である
```

## 受け入れ基準（4-8件）

- [ ] Layer 0 に `src/utils/limits.ts` を新設し、`src/messaging/limits.ts` の純定数部を移設している。定数の値・名前・export 形状は不変である。
- [ ] 旧パス `src/messaging/limits.ts` は value-preserving な re-export shim として残し、全 21 消費ファイルを新規パスへ段階的に更新している。
- [ ] `src/messaging/validators.ts:58-61` の 4 cap 定数と `VALIDATOR_LIMITS`（`validators.ts:68-95`）が `src/utils/limits.ts` へ統合され、`src/background/pipeline/mappers/commonStorageFields.ts:12-17` が `utils/limits` を直参照している。
- [ ] `src/offscreen/queryPlan.ts:254` の `QUERY_CAPS` re-export を廃止し、offscreen が `utils/limits` を直接 import している。kludge の根拠コメント（`src/messaging/limits.ts:69-72`）が削除または訂正されている。
- [ ] `src/utils/crypto/envelope.ts:11` が `messaging/limits` を import している Layer 0 → messaging の逆辺が解消され、`LAYERS.md:30` および `eslint/rules/utils-layer-boundary.mjs:31` の Layer 0 登録リストから messaging への参照が消えている。
- [ ] `src/messaging/limits.ts:59-60` の drift した説明コメント（Layer 0 は messaging を import できずローカル再宣言する）が現状と一致する内容へ更新、または削除されている。
- [ ] layer lint の Layer 0 分岐が「`src/utils/` 外への static import は error（shim を含む指定例外を除く）」を報告し、rule test を追加している。
- [ ] `npm run validate` が成功し、既存のビルド・テスト・メッセージ契約・ユーザーに観測される動作に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 受信 extent 検証と row cap を持つ実メッセージの往復を観測点とし、検証結果と表示メッセージが同一であることを Outside-In で確認する。
- ダッシュボードの履歴一覧・archive 一覧の表示件数・バイト制限が同一であることを確認する（定数値が変わっていないことの外側からの確認）。
- 新規のユーザー機能は追加しない。

### 統合テスト

- 移行後の import 経路を検証する: 21 消費ファイルが `utils/limits` を import している、background pipeline が messaging を経由せずに cap 値を取得している、offscreen が `utils/limits` を直接 import している。
- messaging の型モジュールが runtime で background の messageTypes を読む経路が、cap 取得のために background モジュールを引き込まないことを確認する。
- shim からの re-export が同値の値を返すこと（value-preserving）を検証する。

### 単体テスト

- layer lint rule test に「Layer 0 ファイルが `src/messaging/*` を import すると error」「allowlist 指定があれば通過」「shim からの re-export は指定例外として通過」の 3 ケースを追加する。rule test は `createRepeatSafeRuleTester` を通し、`--repeats` で再実行しても green であること。
- 「docs と実装の同期を機械検査するテスト」（例: poll 間隔規則の検査）が定数の所在を pin していないか、実装冒頭で確認する。pin している場合は新配置へ更新する。
- 移設した定数について、export 名と値が保存されていることと、意図しない削除が発生していないことを検証する。
- 実時間待ち sleep を含まない。

## 実装アプローチ

- **Outside-In**: 先に「検証結果・row cap・メッセージ文字列が同一である」ことを外側の観測点として固定し、そのうえで物理配置と import を移す。
- **Red-Green-Refactor**: lint ルールの未分類バイパスを Red（Layer 0 ファイルが messaging を import しても green になる）として再現し、Layer 0 分岐の判定追加で Green にする。定数の移設は Green 固定後の refactor とする。
- **shim の位置づけ**: 旧パスは shim として残すが、移行の期限を同じ PBI 内に置く。shim 残置は barrel 再導入と同じ姿になるため、`import` 検索で旧パス参照が 0 件になることを DoD の条件にする。
- **YAGNI 遵守**: 定数の追加・再分類・命名変更は行わない。shim にも deprecation ラッパーを重ねない。lint ルールの新オプション（per-file allowlist の DSL化、import 種別別の設定）は必要な例が観測されてから検討し、事前には足さない。
- **1 ファイルずつ**: 移設（`messaging/limits.ts` → `utils/limits.ts`）と validators 統合と lint 強化を 1 コミットに押し込まず、各段階で `npm run validate` を通してから次へ進む。

## 見積もり（**1.5 SP** + 内訳）

- `src/utils/limits.ts` の新設と messaging 側純定数の移設（shim 含む）: 0.5 SP
- 21 消費ファイルと `commonStorageFields.ts:12-17`、`queryPlan.ts:254` の import 更新: 0.4 SP
- `validators.ts:58-61` と `VALIDATOR_LIMITS`（`validators.ts:68-95`）の統合と drift コメントの訂正: 0.25 SP
- layer lint の Layer 0 分岐強化（判定追加・allowlist 例外・rule test）: 0.35 SP
- 合計: **1.5 SP**

## 技術的考慮事項（file:line 付き）

- `src/messaging/limits.ts:1` は `// @layer 0 — Foundation: pure constants, no dependencies` と自己申告しているが、実態は import 0 の純定数であり、`LAYERS.md` の Layer 0 定義（`src/utils/` 配下の純粋モジュール）から外れる。
- 消費 21 ファイル。うち `src/utils/crypto/envelope.ts:11` が `LAYERS.md:30` / `eslint/rules/utils-layer-boundary.mjs:31` で「Layer 0」指定のファイルとして `messaging/limits` を import しており、Layer 0 → messaging の意味上の逆辺になっている。
- lint が見逃す構造: `eslint/rules/utils-layer-boundary.mjs:227-246` の Layer 0 分岐は `LAYER1_FILES` / `LAYER2_MODULES` との照合しか行わず、`src/messaging/*` はどちらのリストにも無いため `create()` が未分類として空の visitor を返す（`:199-201` 相当の未分類バイパス）。
- コメント drift: `src/messaging/limits.ts:59-60` は「Layer 0 modules can't import messaging → re-declare locally and get caught by drift guard」と主張するが、実際は `envelope.ts` が import している。drift guard はこのケースを検出していない。
- 逆方向依存の 4 定数: `src/background/pipeline/mappers/commonStorageFields.ts:12-17` が `MAX_BYTE_STAT_BYTES` / `MAX_CLEANSED_ELEMENTS` / `MAX_CLEANSED_REASON_CHARS` / `MAX_CLEANSED_REASONS` を `messaging/validators.ts` から取得する（定義元は `validators.ts:58-61`）。pipeline 配下で validators を runtime import するのはこの 1 ファイルのみ。
- `src/messaging/types.ts:156` が runtime で background の messageTypes を読むため、4 定数の取得のために 321 行の background モジュールが transitive に引き込まれる。
- 方針の既存判断: `src/messaging/limits.ts:84-95` は「Layer 0 cap は validators ではなく limits.ts に集約」の方針を記載しており、`validators.ts` 自身も 9 つの上限を `limits.ts` から import 済みである。
- re-export kludge: `src/messaging/limits.ts:69-72` は `QUERY_CAPS` の re-export 理由を「OPFS worker cannot import messaging directly」としているが、`messaging/limits` は純定数で文脈依存がない。`src/offscreen/queryPlan.ts:254` がその re-export を利用している。
- 依存関係: PBI `2026-09-28-14`（messaging 逆辺解消）は `validators.ts` と limits 領域が重なるため本 PBI に依存し、10 → 14 の順で進める。
- 移行時は `utils/limits.ts` を `eslint/rules/utils-layer-boundary.mjs:31` の Layer 0 登録リストに追記する。登録漏れると新しい SSOT が検査対象外になる。
- 既存運用: `agent-poll-interval.test.ts` のように「docs と実装の同期を機械検査するテスト」をこのリポジトリは持つため、同種の検査が limits の所在を pin していないか実装冒頭に確認する。

## 実装者向け注記

### 現状コードの確認

- `src/utils/limits.ts` は未作成である。新設対象である。
- `src/messaging/limits.ts` は header で `@layer 0` を宣言し、`MAX_*` / `AUDIT_CAP_*` / `QUERY_CAPS` 等の純定数を持つ。import は 0 である。
- 消費は 21 ファイルで、`envelope.ts` を含む Layer 0 側からの import が 1 件ある。
- `utils-layer-boundary.mjs` の Layer 0 分岐は LAYER1 / LAYER2 / BARREL のみを検査するため、`src/messaging/*` への import は allowlist なしで通過する。
- `validators.ts:58-61` の 4 定数は `commonStorageFields.ts` だけが background 側から参照し、他の 9 個は既に `limits.ts` へ寄っている。
- `messaging/types.ts:156` の background 参照は 4 定数取得と無関係だが、同じ import グラフ上にあるため、cap 取得経路に紛れ込まないことを確認する。

### 実装手順

1. 定数の所在を pin する検査（docs と実装の同期を機械検査するテスト）が `messaging/limits` を参照していないかを確認する。あれば新配置へ更新する。
2. `src/utils/limits.ts` を新設し、`src/messaging/limits.ts` の純定数部を移設する。export 名と値はそのまま維持する。
3. 旧パスを re-export shim にして、21 消費ファイルを新パスへ更新する。各段階で `npm run validate` を通してから次へ進む。
4. `validators.ts:58-61` の 4 定数と `VALIDATOR_LIMITS` を `utils/limits.ts` へ統合し、`commonStorageFields.ts:12-17` を直参照へ切り替える。
5. `queryPlan.ts:254` の `QUERY_CAPS` re-export をやめ、offscreen から `utils/limits` を直接 import する。`messaging/limits.ts:69-72` の kludge コメントを削除する。
6. `messaging/limits.ts:59-60` の drift した説明コメントを、現状（`envelope.ts` が import している）と整合する内容へ訂正する、または撤去する。
7. `utils/limits.ts` を layer lint の Layer 0 登録リストへ追加する。
8. layer lint の Layer 0 分岐に「`src/utils/` 外への static import は error（shim と指定例外を除く）」の判定を追加し、rule test（`eslint/__tests__/utils-layer-boundary.test.ts`）にケースを追加する。
9. 旧パス `src/messaging/limits` の import 残存が 0 件であることを検索で確認する。shim 自体を残すべきではない場合は、この時点で撤去する。

### 落とし穴

- shim 残置は barrel 再導入と同じ姿になる。「移行中」という名前だけが残り、以降の追加実装が新ファイルでも shim でも import 張る。shim は移行期限を置き、全 import 更新まで同じ PBI 内で完了させる。
- 機械検査が定数の所在を pin していると、移設直後にそのテストが赤になる。「expected される diff」に見せないよう、意図的な更新として扱う。
- `utils/limits.ts` を Layer 0 登録リストに追記し忘れると、新しい SSOT が検査対象外になり、本 PBI の目的が失われる。
- lint の Layer 0 判定を「`src/messaging/*` を禁止」に限定すると、他の新 Layer（popup、offscreen、content など）への誤検知を生む。`src/utils/` 外という一般的な規則として実装する。
- shim からの re-export を無条件に許可すると、shim 経由の逆辺が恒久化する。shim は指定例外として明示し、期限切れ shim を lint で検出できる形にする。
- 4 定数を `utils/limits` へ移すと `validators.ts` の責務が曖昧になる（上限定義と検証ロジックの同居）。`VALIDATOR_LIMITS` の集約先は `limits.ts` 側とし、検証ロジックは `validators.ts` に残す。
- `messaging/types.ts:156` の background 参照と 4 定数取得の依存を 1 本の依存と見なすと、`2026-09-28-14` の領域まで巻き込む。対象を cap 取得の 4 定数に限定する。
- 値・export 形の変更（`as const` の付け替え、object 凍結、`QUERY_CAPS` の形状変更）を「整理」として入れると、メッセージ契約が変わる。移設は値と形の保存だけを許容する。
- eslint rule のテストに単純な `new RuleTester` を使うと、`--repeats` 実行時に緑にならない既知の問題がある。`createRepeatSafeRuleTester` を使う。

## 決定事項

1. cap 定数の正規の配置先を Layer 0 の `src/utils/limits.ts` とする。`src/messaging/limits.ts` の `@layer 0` 自己申告は撤回する。
2. 値は不変とし、定数の追加・削除・命名変更・export 形状の変更を行わない。
3. 旧パスは移行期間のみ re-export shim として残し、全 21 消費ファイルと background / offscreen 側の import 更新を同じ PBI 内で完了させる。shim の残置を DoD 完了の後に持ち越さない。
4. `validators.ts:58-61` の 4 定数と `VALIDATOR_LIMITS` は「Layer 0 cap を limits に集約する」既存方針に従い `utils/limits.ts` へ統合し、検証ロジックは `validators.ts` に残す。
5. `QUERY_CAPS` の messaging 経由 re-export を廃止し、offscreen は `utils/limits` を直接 import する。kludge の根拠コメントは削除する。
6. layer lint の Layer 0 判定を `src/utils/` 外への static import 禁止として一般化し、shim は明示的な指定例外として扱う。
7. `utils/limits.ts` を Layer 0 登録リストへ必ず追加し、登録漏れによる検査対象の抜けを防ぐ。
8. PBI `2026-09-28-14` と対象領域を分離するため、`messaging/types.ts:156` の background 参照には手を加えない。10 → 14 の順で進める。
9. 機械検査テスト（docs と実装の同期を検査するテスト）が定数所在を pin している場合は、新配置への更新を本 PBI のスコープに含める。

## Definition of Done

- [ ] すべての Layer 0 cap 定数が `src/utils/limits.ts` に定義され、`src/messaging/limits.ts` からは value-preserving な shim としてのみ参照されている。
- [ ] 旧パス `src/messaging/limits` への import が残存しておらず、shim は移行期限を置き、全 import 更新と同じ PBI 内で撤去される。
- [ ] `commonStorageFields.ts` が `utils/limits` を直参照し、pipeline から messaging validators への runtime 依存が解消されている。`queryPlan.ts` の `QUERY_CAPS` re-export が廃止され、offscreen が `utils/limits` を直接 import している。
- [ ] 観測挙動が不変である: cap の値、API 形状、メッセージ契約、検証結果と表示メッセージがすべて本 PBI 前と一致している。
- [ ] `src/utils/crypto/envelope.ts:11` を含む Layer 0 からの messaging import が解消され、LAYERS 文書と lint の Layer 0 登録リストが新配置と一致している。
- [ ] layer lint が `src/utils/` 外への Layer 0 static import を error として報告し、rule test（allowlist あり / なし / shim 例外の 3 ケース）が `createRepeatSafeRuleTester` 経由で green である。
- [ ] drift したコメント（`messaging/limits.ts:59-60` の「Layer 0 は messaging を import できない」主張、`limits.ts:69-72` の kludge 理由）が現状と整合する内容へ更新または削除され、「docs と実装の同期を機械検査するテスト」が定数の所在を pin していた場合は新配置へ更新されている。
- [ ] 共通化と同時に定数の追加・export 形状の変更・lint オプションの DSL 化を行っていない（YAGNI 遵守）。
- [ ] `npm run validate` が成功し、既存ビルド・テスト・メッセージ契約・ユーザー観測挙動に回帰がない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
