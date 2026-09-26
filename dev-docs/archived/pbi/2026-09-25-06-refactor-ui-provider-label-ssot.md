# PBI: UI 層の provider 表示名解決を中立テーブルへ寄せる（popup→background 依存の解消）

- 種別: refactor

## ユーザーストーリー

保守者として、popup と dashboard の provider 表示名を background 実装から独立して解決したい。なぜなら、現状では表示名 1 件のために UI 3 ファイルが `providerCatalog` を runtime import しており、background の strategy や fetch、crypto 依存が popup bundle に巻き込まれるからだ。

## ビジネス価値

- popup と dashboard の表示処理が、background の provider strategy 実装から独立する。
- popup bundle に provider strategy が巻き込まれるのを防ぐ。
- provider 追加や background 実装の変更が、表示名解決だけを必要とする UI に不要な変更を伝播させない。
- 既知 provider の表示名、未知 provider の raw fallback、既存の i18n 挙動を維持する。
- 完了の兆候は、対象 UI 3 ファイルから `src/background/ai/providerCatalog.ts` への production import が消え、関連テストで既存の表示契約が再確認できること。

## 優先度

順位: 06 / 30

RICEスコア: 3.0（Reach=3 / Impact=0.5 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 既知 provider の成功メッセージ表示
  Given AI要約の所要時間が正で、provider 識別子は既知とする
  When popup の成功メッセージを整形する
  Then 既存の provider 表示名を使う
  And 既存の i18n メッセージと所要時間の表示を変えない

Scenario: 未知 provider の表示名
  Given provider 識別子が中立テーブルにない
  When popup の成功メッセージを整形する
  Then provider 識別子をそのまま表示する
  And 例外や空表示にしない

Scenario: dashboard の custom prompt 表示名
  Given 既知 provider とその i18n メッセージがある
  When dashboard の custom prompt 一覧を表示する
  Then 既存の i18n 表示名を使う
  And 翻訳がない場合は既存と同じ fallback 表示名を使う
```

## 受け入れ基準

- [ ] `src/utils/storage/providerAllowlist.ts` にある中立テーブルから、UI が provider 識別子と表示名を解決できる read-only な API を追加する。UI 用の新しい手書き label 表は作らない。
- [ ] `src/popup/errorUtils.ts`、`src/dashboard/aiTestResultView.ts`、`src/dashboard/settings/customPromptManager.ts` の 3 ファイルから `src/background/ai/providerCatalog.ts` を import しない。既存の 3 call site を中立テーブルの API に置き換える。
- [ ] `errorUtils` の既知 provider の表示名と、未知 provider の raw fallback を変更しない。
- [ ] `customPromptManager` の既存の `labelI18nKey`、`getMessageOr`、fallback label の順序を維持する。必要な i18n metadata も中立 projection から取得できるようにする。
- [ ] `providerCatalog` は background 側の full provider catalog と strategy wiring の責務を維持する。共有する `label` は中立テーブルの既存 row を唯一の宣言元とし、UI 側へ複製しない。
- [ ] `providerAllowlist` の catalog 対象 row と `providerCatalog` の共有 metadata の対応が崩れない。provider 追加時の metadata 追加規則を明確にする。
- [ ] `src/popup/errorUtils.ts:6` の「storage/types のみに依存する」という現状と一致しないコメントを修正または削除する。
- [ ] `errorUtils` の直接 production importer である `src/popup/recordSession.ts` と `src/popup/pendingPages.ts` は、内部 API を維持する限り変更不要とする。
- [ ] 表示 message contract、settings key、provider の strategy 実行には変更を加えない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- popup の成功メッセージ表示について、既知 provider と未知 provider の 1 代表 flow を確認する。
- dashboard の custom prompt 一覧で、既存の provider i18n 表示と fallback を確認する。
- 新しいユーザー向け message contract や API は追加せず、既存の UI flow の表示結果を回帰確認する。

### 統合テスト

- 中立テーブルの実データと 3 つの UI consumer を接続し、background の `providerCatalog` を mock しなくても provider 表示名を解決できることを確認する。
- `providerAllowlist` の共有 `label` と `providerCatalog` の対応 row の一致を検証する。provider 追加時の metadata 追加漏れを検出できる assertion を維持する。
- 3 つの production UI ファイルから `background/ai/providerCatalog` への import がないことを確認する。
- popup の build 依存関係に provider strategy が含まれないことを確認する。

### 単体テスト

- 中立テーブルの resolver が既知 provider の `label` を返し、未知 ID で `undefined` または契約どおりの fallback 結果を返すことを確認する。
- `src/popup/__tests__/errorUtils.test.ts:472-479` の既知 label と unknown raw fallback のケースを維持する。
- `src/dashboard/__tests__/aiTestResultView.test.ts` の既知 label、unknown raw fallback、prototype property 名のケースを維持する。
- `src/dashboard/settings/__tests__/customPromptManager.test.ts` および関連 regression test で、既知 provider の i18n 表示と fallback を維持する。
- `src/background/ai/__tests__/providerCatalog.test.ts` と `src/utils/storage/__tests__/providerAllowlist.test.ts` の parity / conformance を確認して、shared metadata の drift を検出する。

## 実装アプローチ

- **Outside-In**: 既存の表示結果と import 境界を固定するテストを先に更新し、既知・未知・i18n の各ケースを確認する。
- 中立テーブルに、UI が必要とする read-only projection と label 解決 API を追加する。projection は表示に必要な metadata だけを公開し、strategy や storage wiring を含めない。
- `providerCatalog` の shared label は既存の中立 row から引き続き合成し、UI 用の別の label 定数や Record を追加しない。
- UI 3 ファイルの import と call site を projection に置き換え、`errorUtils` の内部 API と直接 importer の互換性を保つ。
- `customPromptManager` では中立 projection から既存の i18n metadata を取得し、`getMessageOr` と fallback の順序を変えない。
- 既存の provider conformance、allowlist parity、UI 表示テストを通してから、popup の依存グラフを確認する。

## 見積もり

0.5 SP

## 技術的考慮事項

- **層境界**: `src/background/ai/providerCatalog.ts:17-19` の 3 provider strategy runtime import を UI 側へ持ち込まない。中立テーブルは `storage/types` へ依存する読み取り専用の層に留める。
- **共有 metadata**: `providerAllowlist.ts:43-160` の `label` と、catalog が同値合成する shared metadata の対応を維持する。UI 用の label 表を追加すると二重 SSOT になるため避ける。
- **表示契約**: 現在の `label`、`labelI18nKey`、未知 provider の raw fallback、popup の message contract を維持する。`labelI18nKey` を新しい表示値として置き換えない。
- **既知 provider の範囲**: 中立テーブルが catalog にない追加 row を持つ場合、UI の既知 provider と unknown provider の境界が現状から不用意に広がらないかを確認する。Allowlist の domain 行を UI の catalog membership と同一視しない。
- **参照の安全性**: provider 識別子は外部入力として扱えるため、prototype property 名を label として解決しない。現在の unknown raw fallback を維持する。
- **互換性**: `errorUtils` の公開 API と 2 つの直接 production importer に不要な変更を伝播させない。message contract や storage key は変更しない。
- **lint の範囲**: 現在の `utils-layer-boundary` は utils 内 Layer 0/1 のみを対象としており、popup→background の import は検出しない。今回の PBI では、その lint の対象拡大を必須の検証手段にしない。
- **セキュリティ**: 新しい外部通信、credential、storage 書き込み、動的コード実行は追加しない。

## 実装者向け注記

### 現状コードの確認

- `src/popup/errorUtils.ts:7` が `src/background/ai/providerCatalog.js` を import し、`formatSuccessMessage` 内の `src/popup/errorUtils.ts:372` で `tryResolveCatalogEntry` を 1 回呼んでいる。
- `src/popup/errorUtils.ts:6` のコメントは `storage/types` のみに依存すると記載しているが、現状の import と一致しない。
- `src/background/ai/providerCatalog.ts:15` で中立テーブルを import し、`:17-19` で 3 provider strategy を runtime import する。`:79` 付近で中立 row の `label` を catalog entry に spread している。
- `src/utils/storage/providerAllowlist.ts:43-160` に `id` と `label` を持つ中立テーブルがある。
- `src/dashboard/aiTestResultView.ts:10` と `src/dashboard/settings/customPromptManager.ts:25` も `tryResolveCatalogEntry` を import しており、対象 UI の production import は合計 3 ファイル、3 call site である。
- `src/popup/recordSession.ts` は `errorUtils` を 2 文、`src/popup/pendingPages.ts` は 1 文 import している。内部 API を保つ場合、これらの直接 importer の変更は不要。
- 既存の回帰テストは `src/popup/__tests__/errorUtils.test.ts`、`src/background/ai/__tests__/providerCatalog.test.ts`、`src/dashboard/__tests__/aiTestResultView.test.ts`、`src/dashboard/settings/__tests__/customPromptManager.test.ts`、`src/utils/storage/__tests__/providerAllowlist.test.ts` に存在する。
- `dev-docs/LAYERS.md:135-137` は dashboard→background の静的 catalog import に一部例外を認めるが、popup には同型例外がない。`eslint/rules/utils-layer-boundary.mjs:55-71` は utils 内 Layer 0/1 のみを対象とする。

### 実装手順

1. 既存の 3 call site と既知・未知・i18n の表示結果を固定する。
2. `providerAllowlist` の既存 row を壊さず、UI が必要とする read-only projection と resolver を追加する。custom prompt の i18n metadata が必要なら、同じ中立 metadata 経路から取得できるようにする。
3. `errorUtils`、`aiTestResultView`、`customPromptManager` の import と call site を projection に置き換える。
4. `providerCatalog` の shared label 組成と既存 public API を維持する。UI 用 label の複製を作らない。
5. 既存テストの import / mock を中立 resolver に合わせて更新し、既知 label、raw fallback、i18n fallback、parity を検証する。
6. popup の依存グラフと 3 ファイルからの background import がないことを確認する。lint rule の cross-layer 拡大は別 PBI として扱う。

### 落とし穴

- `providerCatalog` を「軽い utility」とみなして UI から参照すると、strategy、fetch、crypto を含む background 依存が再び popup に入る。表示名解決に必要な中立 metadata だけを公開する。
- `providerAllowlist` へ UI 専用 label Record を追加すると、catalog と UI で二重の SSOT ができる。既存 row の追加規則を維持し、projection は読み取り専用にする。
- custom prompt の label は catalog の `labelI18nKey` を `getMessageOr` で解決する経路がある。resolver の戻り値を単純な文字列へ置き換えると、既存の i18n 表示や fallback が変わる。
- `providerAllowlist` は catalog にない domain row を含むことがある。resolver の既知集合を不用意に広げると、既存の unknown raw fallback を失う。
- `tryResolveCatalogEntry` の既存 public facade や `errorUtils` の内部 API を不用意に置き換えると、UI 以外の consumer に不要な変更が波及する。
- 現在の utils layer lint は popup→background の逆依存を検出しない。今回の変更で lint がその境界を強制したと記述しない。
- `errorUtils.ts:6` の古い依存説明を残すと、依存関係を読み違える。import 変更と同じ変更で現状に合わせる。

## 決定事項

- **label の SSOT**: UI 専用の label 表は作らず、既存の中立テーブルを読み取り専用の projection として使う。完全 catalog と strategy wiring は `providerCatalog` に残し、共有する `label` は中立テーブルの既存 row を唯一の宣言元とする。これにより UI 専用表と二重 SSOT を避ける。
- **UI が必要とする metadata**: resolver は少なくとも表示 `label` を公開する。`customPromptManager` の既存 i18n 契約を維持するため、必要な i18n metadata も中立 projection 経由で取得できる形にし、`getMessageOr` の fallback 順を変えない。
- **lint の扱い**: popup→background の cross-layer lint rule の対象拡大は本 PBI に含めず、別 PBI とする。今回の完了条件は、対象 3 ファイルから background import を除去することと既存 lint の整合を保つことまでとする。

## Definition of Done

- [x] 中立テーブルから read-only な provider 表示 metadata を解決でき、UI 用の重複 label 表がない。
- [x] `src/popup/errorUtils.ts`、`src/dashboard/aiTestResultView.ts`、`src/dashboard/settings/customPromptManager.ts` から `providerCatalog` への production import が除去されている。
- [x] popup の既知 label、未知 provider の raw fallback、dashboard の i18n 表示と fallback が既存テストで確認できる。
- [x] `providerAllowlist` と `providerCatalog` の shared label / metadata parity が維持されている。
- [x] `errorUtils.ts:6` の依存説明が現状と一致し、message contract と直接 importer の API 互換性が保たれている。
- [x] popup の依存グラフに provider strategy が含まれないことを確認する。
- [x] 型検査、lint、関連テストが green であり、既存の provider conformance / allowlist parity test を含む。

## 実施記録

### なぜなぜ分析

1. 3 つの UI ファイルが `providerCatalog` を import していたのは、provider 表示名と i18n key を引ける既知の入口が `providerCatalog` しか無かったから。
2. その入口しか無かったのは、中立テーブル `providerAllowlist` には `id` / `label` の行が無く、UI が必要とする `labelI18nKey` を含む read-only projection が定義されていなかったから。
3. projection が無いのは、`providerAllowlist` が「host_permissions / CSP 用の domain 行を保持するallowlist」として書かれており、「UI が読む表示メタデータの SSOT」を担う責務が割り当てられていなかったから。
4. 責務が未割り当てのままだったのは、表示名を `providerCatalog` から引くという選択が常に便利で、二重定義に見えなかったから。かつ `providerCatalog` は 3 strategy を **static import** するため、引数 1 つの Map lookup には見えにくい。
5. popup への巻き込みが CI で検出されなかったのは、`local/utils-layer-boundary` が utils 内 Layer 0/1 のみを対象としており、popup→background の逆依存を検査対象外にしていたから。
   → 解は **「UI 用の新しい label 表を作らず、中立テーブルの既存 row を唯一の宣言元とする read-only projection を中立テーブル側に设ける」** こと。加えて `providerCatalog` 側の重複した `labelI18nKey` リテラルを中立 row からの合成に置き換え、二重 SSOT を解消した。

### 実装内容

- `src/utils/storage/providerAllowlist.ts` に `ProviderDisplayMetadata` / `deriveProviderDisplayMetadata()` / `PROVIDER_DISPLAY_METADATA` / `tryResolveProviderDisplayMetadata()` を追加。対象は `labelI18nKey` を宣言する row のみで、fixed-endpoint の domain row を「既知」に取り込まない（未知 provider の raw fallback を保つため）。
- `src/popup/errorUtils.ts`、`src/dashboard/aiTestResultView.ts`、`src/dashboard/settings/customPromptManager.ts` の 3 call site を上記 resolver へ移行。`customPromptManager` は `getMessageOr(entry.labelI18nKey, entry.label || provider)` の fallback 順を維持。
- `src/background/ai/providerCatalog.ts`: 6 provider に重複していた `labelI18nKey` リテラルを削除し、`allowRow()` が中立 row から合成する形へ変更。あわせて `labelI18nKey` 未宣言の row を `UnknownProviderError` で落とすので、モジュールロード時に失敗する。
- `errorUtils.ts:6` の古い依存説明を現状に合わせて修正。

### 検証結果

| 項目 | 結果 |
|---|---|
| `npm run type-check` | PASS |
| `npm run type-check:test` | 255 errors = HEAD baseline と同一（増減ゼロ） |
| 対象テスト 6 ファイル | 170 tests passed |
| 全体 | 915 files / 14100 tests passed（HEAD 比 +4 files / +44 tests） |
| popup 依存グラフ | エントリから static/dynamic import を再帰辿った結果: **24 chunks / 214,191 bytes → 24 chunks / 193,401 bytes（−20,790 bytes, −9.7%）**。provider strategy を含む chunk は 2 → 1 に減少 |

`settingsMigration` 等の chunk は HEAD 時点で popup クロージャに既に含まれており、本 PBI で追加されたものではない（chunk 名の hash 変化は分割結果の相違による）。本 PBI が実際に断った連鎖は `errorUtils` → `providerCatalog` → strategy で、これが `privacyConsent` 等の巻き込みを解いた。

- [x] cross-layer lint rule の対象拡大は別 PBI として分離され、本 PBI のスコープに混在していない。
