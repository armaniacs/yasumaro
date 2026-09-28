# PBI: AI要約クレンジング設定保存の delta-write 化

## ユーザーストーリー

保守者として、AI要約クレンジング設定の保存経路を delta-write 契約に沿わせたい。なぜなら `getAll()` のスナップショットを書き戻す full-snapshot writer が、PBI 2026-09-28-02 の台帳送り以降も production に残っており、stale cache を持ち込む契約違反が解消されていないからだ。

## ビジネス価値

- PBI 2026-09-17-17 で確立した delta-write 契約を、本領域の最後の full-snapshot writer へ普及させ、契約を production 全体で一意にする。
- 他キーの古い値を書き戻さないことで、並行する writer（whitelist / preset / settingsPipeline）が保存直前に書いた値を巻き戻す事故を無くす。
- 契約違反の形を局所 pin で静的テストに落とすことで、次回の pasted full-snapshot 再発をレビュー目視ではなく機械で検出できるようにする。
- 書かれる最終値が同一のままであるため、観測される挙動は変わらず、差分は「他キーを巻き戻さない」1 点に限られる。

## 優先度

- 種別: refactor
- 順位: 20 / 23
- RICEスコア: 4.0（Reach=2 / Impact=1 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: AI要約クレンジング設定の保存が delta 書き込みになる
  Given ダッシュボードの AI要約クレンジング設定フォームで値を変更した
  When 保存を実行する
  Then settingsRepository.setAll はフォームが所有するキーだけの delta を受け取る
  And 保存前に読み出した全設定スナップショットは setAll に渡らない

Scenario: 同時に別の writer が書いたキーが巻き戻らない
  Given 保存の直前に別の経路が storage 上の無関係なキー（例: whitelist 設定）を更新した
  When AI要約クレンジング設定の保存が完了する
  Then その無関係なキーは別経路が書いた値のまま維持される

Scenario: 全ルールのフラグが delta に含まれ、欠損時のみ false になる
  Given 一部のルールフラグが settings オブジェクトに含まれない
  When 保存を実行する
  Then CLEANSING_RULES の全ルールの storageKey が delta に含まれる
  And 欠損したルールフラグは false として保存される（既存挙動の維持）

Scenario: 静的 pin が full-snapshot への回帰を検出する
  Given 対象ファイルに getAll() スナップショットを setAll へ渡す構文が再導入された
  When 契約テストが走査する
  Then 検出され、テストが Red になる
```

## 受け入れ基準

- [ ] `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` の `saveAiSummaryCleansingSettings` が、`settingsRepository.getAll()` を通さずに delta オブジェクトを `setAll` へ渡す形に変更されている。
- [ ] 受け取る delta は `settings` 引数から組み立てられ、フォームが所有するキー（enabled、`CLEANSING_RULES` 由来の動的キー、各スライダーとトグル）だけを含む。
- [ ] 動的キーの構築は `ruleOptionKey(rule)` を経由し、既存の `?? false` フォールバックが維持されている。
- [ ] `settingsRepository` の新しい API（`set` 以外）を追加していない。`setAll` へ delta を渡す形を維持している。
- [ ] `src/utils/storage/__tests__/domainFilterCacheSaveSeamContract.test.ts` の detector は本 PBI で大改修していない。対象ファイル限定の局所 pin（`settingsRepository.getAll()` 呼び出し 0 件）として追加している。
- [ ] 局所 pin には「構文を再導入すれば検出できる」negative control が 1 件あり、単に常時 Green なアサーションになっていない。
- [ ] `src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2.test.ts:207-218` の既存テスト（`getAll` の戻り値が `setAll` の payload に残ることを前提としたアサーション）が delta 前提へ更新されている。
- [ ] IIFE 化は行っていない。`saveSettingsAndRefreshDomainFilterCache` seam は domain キー専用であり、本 PBI の対象キーは含まれない。
- [ ] `npm run validate` が成功し、既存の settings / preset / cleanse 関連テストに回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「AI要約クレンジング設定を変更して保存し、その値が後続の Recording の AI要約生成に反映される」という観測点を確認する。
- 新しいユーザー機能は追加しない。既存の観測結果が変わらないことを Outside-In の観測点とする。
- dashboard を開き直した状態でも保存した値が復元されることを確認する。

### 統合テスト

- `settingsRepository.setAll` へ渡る値のキー集合が、フォームが所有するキー集合（`CLEANSING_RULES` の全 `storageKey` と各スライダー・トグル）と一致することを確認する。`getAll` の戻り値に含まれる無関係なキーが delta に混ざらないことを併せて確認する。
- 正規実装と同じ patch 形状であることを確認する: `src/dashboard/settingsPipeline.ts:241-245`、`src/dashboard/settings/contentSettings.ts:72-73`、`src/dashboard/settings/customPromptManager.ts:317-321`、`src/utils/aiSummaryCleaner/cleansingPresetStore.ts:191-205`。
- 局所 pin（静的走査）が full-snapshot 構文の再導入で Red になることを、negative control テストで確認する。

### 単体テスト

- `saveAiSummaryCleansingSettings` に全ルールフラグあり / 一部欠損 / 全欠損の 3 系統を渡し、delta のキー集合と値を検証する。
- 欠損したルールフラグが `false` として保存されることを確認する（既存テストが持つ pin の維持）。
- `settingsRepository.getAll` が save 経路上で呼ばれていないことを、mock の call 履歴で確認する。
- delta に `CLEANSING_RULES` に無いキーが含まれないことを確認する（動的キー生成の取りこぼし検出）。

## 実装アプローチ

- **Outside-In**: まず「保存後に無関係なキーが巻き戻らない」という storage 層の観測点を failing として用意し、green にする。
- **Red-Green-Refactor**: 局所静的 pin を先に追加し、現在の full-snapshot 構文で Red になることを確認してから delta 化で Green にする。
- **delta の組み立て方**: `settings` 引数（フォームが組み立てた値オブジェクト）から delta を作り、`getAll()` を呼ばずに `setAll` へ渡す。既存の正規実装と同じ「フォームが所有するキーだけ」の形にする。
- **動的キーの扱い**: `ruleOptionKey(rule)` と `rule.storageKey` を使い、`CLEANSING_RULES` を単一ソースとしてループで列挙する。静的な列挙にしない。
- **IIFE 化しない**: `saveSettingsAndRefreshDomainFilterCache` は `setAll(delta)` の後に `updateDomainFilterCache(await getAll())` を実行する。本 PBI の delta に domain キーは含まれないため、seam を通すと無関係な副作用（cache 再構築）が付く。seam 採用は本 PBI のスコープ外とする。
- **第二経路の扱い**: 台帳が `:171` を「デフォルト復元系の第二経路」と記録しているが、実読すると `:171` は同一関数の最終代入である。実装冒頭でファイル全体を再読し、2 本目があれば同じ delta 化を対象とし、無ければ「1 本のみ」と判断記録に残す。

## 見積もり

**0.5 SP**

1 ファイル 1 関数の delta 化（0.2 SP）。局所静的 pin とその negative control の追加（0.2 SP）。既存テストの delta 前提への更新と `npm run validate`（0.1 SP）。型階層の再整理、seam 導入、i18n は含まない。

## 技術的考慮事項

- 対象は `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` の `saveAiSummaryCleansingSettings`。`const currentSettings = await settingsRepository.getAll();` でスナップショットを読み、フォームが所有するキー群へ代入し、`setAll(currentSettings)` で書き戻す。台帳は `:151` と `:171` の 2 経路として記録していたが、実読すると `:171` は同一関数内の最終代入（`EXTRACTION_GUARD_CONTENT_CLEANSE_ENABLED`）であり、独立した第 2 writer ではない。**本ファイルに full-snapshot writer は 1 本である。**
- delta-write 契約は PBI 2026-09-17-17 で確立された。full snapshot（`{...getAll(), ...patch}` を `setAll` に渡す）は stale cache を持ち込むため禁止である。
- 正規実装例は `src/dashboard/settingsPipeline.ts:241-245`（delta を seam へ渡す）、`src/dashboard/settings/contentSettings.ts:72-73`（`const delta: Record<string, unknown> = {};` をフォーム所有キーで埋める）、`src/dashboard/settings/customPromptManager.ts:317-321`、`src/utils/aiSummaryCleaner/cleansingPresetStore.ts:191-205`（preset が所有するキーだけを delta に入れ、`// Delta write (PBI 2026-09-17-17)` コメントが付く）。
- `settingsRepository.setAll`（`src/utils/storage/SettingsRepository.ts:198-200`）は `Partial<SettingsType>` を受け、`writeSettings`（`:202`）が書き込みロック内で `{ ...base, ...toSave }` として最新値へマージする。delta 渡しにすれば他キーの巻き戻しは起きない。full snapshot だけが問題になる。
- `settingsRepository.getAll()` は TTL 付きキャッシュを返すため、キャッシュ済みのスナップショットを書き戻すと他 writer の変更を確実に巻き戻す。
- `CLEANSING_RULES`（`src/utils/aiSummaryCleaner/rules.ts`）は 33 エントリであり、delta の動的キー（`ruleOptionKey(rule)` から `rule.storageKey` へ）はループで組み立てる必要がある。`ruleOptionKey` の動的アクセスには WHY コメントが既に付いている。
- `rule.storageKey` は storage の実キー、`ruleOptionKey(rule)` は settings オブジェクト上の別名キー（`<key>Enabled`）である。delta に入るのは `rule.storageKey` 側であり、値は `settings[ruleOptionKey(rule)]` から取る。この 2 つの対応を混同すると、存在しないキーを書くか既存値を壊す。
- `src/utils/storage/__tests__/domainFilterCacheSaveSeamContract.test.ts` の detector は pasted IIFE（`await (async (s)=>{ setAll(s); updateDomainFilterCache(await getAll()); })(x)` 形式）と seam 呼び出しの変数転送を検出するが、本ファイルは IIFE ではないため検出対象外である。契約違反は同型（スナップショットを setAll へ渡す）だが構文が異なる。
- 局所 pin の選択肢は 2 つ: (a) detector を「setAll への getAll() スナップショット変数渡し」一般に拡張する、(b) 対象ファイルに限定した局所 pin（`settingsRepository.getAll()` 呼び出し 0 件）を追加する。1 ファイルの修正に対して契約テストの大改修は過剰なため **(b) を採用** する。
- 既存テスト `src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2.test.ts:207-218` は `mockGetSettings` の戻り値 `{ keep: 'yes' }` が `setAll` の payload に残ることを前提に `expect(saved.keep).toBe('yes')` と pin している。delta 化後はこの前提が崩れるため、当該アサーションを「無関係なキーは含まれない」pin へ変える。
- 検証は `npm run validate` に加えて、AI 要約クレンジング関連テスト（`src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2*.test.ts`）と契約テストを実行する。

## 実装者向け注記

### 現状コードの確認

- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` の `saveAiSummaryCleansingSettings(settings: AiSummaryCleansingSettings)` が本 PBI の編集対象関数である。直後が `const currentSettings = await settingsRepository.getAll();`、以降がフォーム所有キーへの代入、末尾が `await settingsRepository.setAll(currentSettings);` である。
- `:171` は同関数の最終代入であり第 2 の writer ではない。ファイル全体を実読して 2 本目が無いことを確認し、結果を判断記録に残す。
- `ruleOptionKey(rule)` は settings オブジェクト上のキー名（`<ruleKey>Enabled`）を返す。保存時の動的アクセスには WHY コメント（実行時に生成されるルールキーのため）が既に付いている。
- `getAiSummaryCleansingSettings()`（同ファイルの上部）は読み取り側であり本 PBI では変更しない。読み取りが `getAll()` を通ることは契約違反ではない（違反は「書き戻す」ことにのみある）。
- `src/dashboard/settingsPipeline.ts:241-245` と `src/dashboard/settings/contentSettings.ts:72-73` は「フォームが所有するキーだけを delta にして setAll へ渡す」形の参照実装である。コメント書式（`// Delta write (PBI 2026-09-17-17) — ...`）も揃える。
- `src/utils/aiSummaryCleaner/cleansingPresetStore.ts:191-205` は「preset が所有するキーだけ」を delta 変数に積み上げ `setAll` へ渡す形の参照実装である。同じ「所有キーを明示する」規律が読める。

### 実装手順

1. `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` 全体を実読し、full-snapshot writer が 1 本か 2 本かを確認する。差があれば本 PBI の「現状コードの確認」を更新する。
2. 「対象ファイルに `settingsRepository.getAll()` が残っていない」ことを検証する局所静的 pin を追加し、現在の full-snapshot 構文で Red になることを確認する。
3. pin には negative control（構文を再導入した文字列で検出できること）を 1 件添え、単に Green に固定されたアサーションにしない。
4. `saveAiSummaryCleansingSettings` を、`getAll()` を呼ばず `settings` 引数から delta を組み立てて `setAll` へ渡す形に変更する。`CLEANSING_RULES` のループで動的キーを列挙し、既存の `?? false` を維持する。
5. `// Delta write (PBI 2026-09-17-17) — ...` の WHY コメントを delta 構築箇所に付ける（正規実装と同じ書式）。
6. 不要になった `getAll()` 呼び出しと未使用になった import がないかを確認する。
7. `src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2.test.ts:207-218` ほか、getAll スナップショットの流転を前提としたアサーションを洗い出し、delta 前提（無関係なキーが含まれない）へ更新する。
8. 局所 pin を採用した理由を判断記録に残す。
9. `npm run validate` と契約テストを実行し、既存挙動に回帰がないことを確認する。

### 落とし穴

- `ruleOptionKey(rule)`（settings 上の別名キー）と `rule.storageKey`（storage の実キー）を混同すると、存在しないキーを書くか既存値を壊す。delta には `rule.storageKey` を入れ、値は `settings[ruleOptionKey(rule)]` から取る。
- delta 構築のために `getAll()` を呼ぶと、full-snapshot と同じ契約違反に戻る。値の取得は `settings` 引数のみから行う。
- 動的キーのループで `?? false` を落とすと、欠損フラグが `undefined` として storage に入り、既存の pin（欠損時は false）が壊れる。
- 既存テストが「getAll の戻り値が setAll の payload に残る」ことを pin している場合、delta 化で意図的に壊れる。期待値を単純に外すと本 PBIの目的をテストが失う。**「無関係なキーが含まれない」ことへの pin へ変更する。**
- 契約テストの detector を一般化するために構文パターンを増やすと false positive が増える。逆に、1 ファイル修正のために detector を大改修すると PBI 2026-09-28-02 の detector 自己テスト（`still detects the pasted IIFE when one is reintroduced`）の初衷と衝突する。局所 pin に留める。
- `saveSettingsAndRefreshDomainFilterCache` seam をここに使うと、AI 要約クレンジング設定の保存のたびに domain filter cache が再構築される。seam は domain キー専用であり本 PBI のキーは含まれない。使わない。
- delta 化すると「保存前に読み出した値が残らない」ことを観測するテストが書けるが、それは他キーの巻き戻しが無くなるためであり意図した変化である。pin の意図を明記する。
- 第二経路が「値を消す（unset 的な）」意図を持つ場合、`setAll` は書き込みロック内で `{ ...base, ...toSave }` とマージするため delta に `undefined` を入れてもキーは削除されない。unset 相当の実装が必要なら delta ではなく `set` 系 API を使い、**この場合だけ本 PBI のスコープを外して台帳に送る。**

## 決定事項

1. 台帳が 2 経路（`src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` と `:171`）と記録したのは、同一関数内の getAll スナップショット書き込みが「保存関数」と「復元関数」に見 구분されていたためである。実際は 1 本の関数であり、`:171` はその最終代入である。
2. ここだけ残ったのは、PBI 2026-09-28-02 が seam 採用箇所を IIFE 形状で列挙し、IIFE でない full-snapshot writer を検出対象の外に置いていたためである。
3. 今是正する必要が立っている理由は、本ファイルが delta-write 契約の違反形態（getAll スナップショットの書き戻し）を保持したまま production に残り、並行 writer の変更を巻き戻す余地を残しているためである。
4. delta は `settings` 引数（フォームが組み立てた値オブジェクト）から構築し、`getAll()` を経由しない。
5. 動的キーは `CLEANSING_RULES` を単一ソースとしてループで列挙し、`ruleOptionKey(rule)` の `?? false` フォールバックを維持する。静的な列挙にしない。
6. 契約テストは局所 pin（対象ファイル内の getAll 呼び出し 0 件）を採用し、detector の一般化は行わない。1 ファイル修正に対する契約テストの大改修は過剰であるためである。
7. IIFE 化と seam 採用は行わない。`saveSettingsAndRefreshDomainFilterCache` は domain キー専用であり、本 PBI の delta に domain キーは含まれない。
8. 観測される挙動（書かれる最終値）は不変とする。差分は「他キーの古い値を書き戻さない」1 点に限られる。
9. `settingsRepository.setAll` は書き込みロック内で `{ ...base, ...toSave }` とマージするため、delta に `undefined` を入れてもキーは削除されない。unset 意図のある経路は本 PBI のスコープ外とし、台帳に送る。

## Definition of Done

- [ ] `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` の `saveAiSummaryCleansingSettings` が `getAll()` を通さず delta を `setAll` へ渡す形に変更されている。
- [ ] delta がフォーム所有キー（enabled と `CLEANSING_RULES` 由来の動的キーと各スライダー・トグル）のみを含み、無関係なキーが含まれない。
- [ ] `ruleOptionKey(rule)` の動的アクセスと `?? false` フォールバックが維持され、既存テストの pin が通る。
- [ ] 局所静的 pin（対象ファイルの getAll 呼び出し 0 件）が追加され、negative control で検出可能であることが確認されている。
- [ ] IIFE 化と seam 採用を行っていないことが理由コメントとして残っている。
- [ ] 台帳が指す第 2 経路の有無を実読で確認し、結果が判断記録に残されている。
- [ ] getAll スナップショットの流転を前提とした既存アサーションが、delta 前提（無関係なキーが含まれない）へ更新されている。
- [ ] `npm run validate` と契約テスト、AI 要約クレンジング関連テストが成功している。
- [ ] 書かれる最終値（フォーム所有キー）が変更前と同一であることをテストで確認している。
- [ ] PBI 2026-09-28-02 の seam 採用決定と PBI 2026-09-17-17 の delta-write 契約を壊していない。
- [ ] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。
