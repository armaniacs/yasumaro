# PBI: domain 設定保存の専用 seam への IIFE 置換

## ユーザーストーリー

保守者として、domain 関連設定の保存経路を既存の専用 seam 1 本へ統一したい。なぜなら byte 同一の IIFE が production 4 箇所に残っており、delta-write 契約に違反する full-snapshot 書き込みが stale cache を持ち込む余地があるためである。

## ビジネス価値

- 保存と domain filter cache 再構築の順序が seam 1 本に集約され、挙動差分の発生がなくなる。
- 既存 PBI 2026-09-17-17 で確立した delta-write 契約を、実際の production writer へ普及させる。
- 同一の pasted IIFE の再発を静的テストで pin でき、レビュー時の目視チェックに依存しなくなる。
- byte 同一の置換と delta 化という 2 段構成のため、挙動不変の検証が段階的に可能になる。

## 優先度

- 種別: refactor
- 順位: 2 / 17
- RICEスコア: 20.0（Reach=5 / Impact=2 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: consent トグルの保存が seam 経由で delta 書き込みになる
  Given Tranco consent パネルの同意ボタンが押された
  When パネルが同意状態を保存する
  Then 専用 seam 経由で delta patch が書き込まれ、domain filter cache が保存後の値で再構築される
  And 保存対象以外の設定キーが書き換えられない

Scenario: タグ設定の保存が既存と同じ結果を返す
  Given タグ設定パネルで正規化辞書を編集した
  When 保存が実行される
  Then 既存実装と byte 同一の storage 結果と cache 再構築結果になる

Scenario: pasted IIFE が production に残っていない
  Given production ソースが特定の形をしている
  When IIFE 形式の保存呼び出しを全文検索する
  Then 検索結果は 0 件である
```

## 受け入れ基準

- [x] `src/dashboard/trancoConsent.ts:147` と `:175` の IIFE が専用 seam 経由の呼び出しへ置換されている。
- [x] `src/dashboard/tagsPanel.ts:228` の IIFE が置換されている。
- [x] `src/dashboard/panels/staticForm/generalSettingsPanel.ts:291` の IIFE が置換されている。
- [x] 置換箇所が delta patch を渡しており、full-snapshot をそのまま setAll していない。
- [x] delta 化が難しい呼び出しは、seam の明示モードへ寄せ、その理由をコメントに残している。
- [x] IIFE 形式の呼び出しが production に残らないことを pin する静的テストを追加している。
- [x] `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` と `:171` の full-snapshot writer について、本 PBI で扱うか台帳送りするかを判断し記録している。
- [x] `npm run validate` と domainFilterCache 関連テストが成功し、既存挙動に回帰がない。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 外部からは「Tranco consent を保存すると、そのドメイン設定が後続の Recording に反映される」という観測点を確認する。
- 既存の結果が変わらないことを Outside-In の観測点とし、新しいユーザー機能は追加しない。

### 統合テスト

- `saveSettingsAndRefreshDomainFilterCache`（`src/utils/storage/domainFilterCache.ts:100-104`）へ切り替えた後も、settings の delta 書き込みと cache 再構築が正しい順序で起きることを検証する。
- 既存(delta-write 契約)の正規実装 `src/dashboard/settingsPipeline.ts:241-245`、`src/dashboard/settings/contentSettings.ts:72-73`、`src/dashboard/settings/customPromptManager.ts:317-321`、`src/utils/aiSummaryCleaner/cleansingPresetStore.ts:191-205` と同じ patch 形状であることを確認する。
- IIFE 全文検索が 0 件になることを、既存の契約テスト構造に倣った静的テストで検証する。

### 単体テスト

- 各置換箇所の呼び出しが seam を通り、patch として正しいキー集合を渡すことを個別に検証する。
- `settingsRepository.setAll` に渡される値が full-snapshot ではなく delta であることを pin する。
- seam 内の delta 判定ロジック（明示モードを含む）の分岐を検証する。

## 実装アプローチ

- **Outside-In**: まず「保存後に cache が正しい値で再構築される」観測点と「IIFE が 0 件」という静的 pin を failing として用意し、それを green にする形で置き換える。
- **Red-Green-Refactor**: IIFE 全文検索が 1 件以上になる状態を Red とし、4 箇所の置換で Green にする。最後に delta 抽出という整理へ進む。
- **byte 同一からの段階適用**: まず置換だけで byte 同一の挙動を維持し、その後 delta 化を個別に適用可能な箇所から順に行う。
- **patch 抽出の判断**: trancoConsent 2 箇所と generalSettingsPanel は consent/設定トグル系の小 patch に縮小できる。tagsPanel は patch 化が難しい可能性がある。
- **seam への集約**: 4 箇所すべてを `saveSettingsAndRefreshDomainFilterCache` に寄せ、implicit な独自経路を残さない。

## 見積もり

**0.5 SP**

4 箇所の置換と delta 抽出、静的契約テストの追加が主体である。seam 自体の新規実装は不要で、`src/utils/storage/domainFilterCache.ts:100-104` は既存。

## 技術的考慮事項

- 専用 seam は既存であり、`src/utils/storage/domainFilterCache.ts:100-104` の `saveSettingsAndRefreshDomainFilterCache` である。docstring に「copy-pasted IIFE を置き換える single seam」と明記されている。
- 残存 IIFE は byte 同一で production 4 箇所にある: `src/dashboard/trancoConsent.ts:147` と `:175`、`src/dashboard/tagsPanel.ts:228`、`src/dashboard/panels/staticForm/generalSettingsPanel.ts:291`。形は `await (async (s)=>{ await settingsRepository.setAll(s); await updateDomainFilterCache(await settingsRepository.getAll()); })(settings);`。
- delta-write 契約は既存 PBI 2026-09-17-17 で確立された。full snapshot（`{...getAll(), ...patch}` を setAll）は stale cache を持ち込むため禁止である。
- 正規実装例は `src/dashboard/settingsPipeline.ts:241-245`、`src/dashboard/settings/contentSettings.ts:72-73`、`src/dashboard/settings/customPromptManager.ts:317-321`、`src/utils/aiSummaryCleaner/cleansingPresetStore.ts:191-205`。
- 追加の full-snapshot writer が `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` と `:171` にあり、`getAll()` 後に 14 キーを書き戻す。
- 置換対象 4 箇所は呼び出し側が組み立てた settings を丸ごと渡しているため、seam への置換は delta patch の抽出を伴う。
- seam の `settingsRepository` は `src/utils/storage/domainFilterCache.ts:101` の動的 import であり、Layer 0 の静的依存グラフを維持するためである。static import へ変えない。
- 検証は `npm run validate` に加えて domainFilterCache 関連テストを実行する。

## 実装者向け注記

### 現状コードの確認

- `src/utils/storage/domainFilterCache.ts:100-104` の seam は `delta: Partial<Settings>` を受け取り、`setAll(delta)` の後に `updateDomainFilterCache(await getAll())` を呼ぶ。3 行の本体だけを差し替える。
- `src/dashboard/trancoConsent.ts:143-147` は `updatedSettings` に 3 キー（granted / denied reason / denied timestamp）を入れてから IIFE を呼ぶ。同意系のパスとして小 patch に縮小できる。
- `src/dashboard/trancoConsent.ts:171-175` も同じ形で、denied reason と timestamp のみを書き込む。
- `src/dashboard/tagsPanel.ts:224-228` は正規化辞書を含む settings を組み立ててから IIFE を呼ぶ。patch 化が可能かを確認する。
- `src/dashboard/panels/staticForm/generalSettingsPanel.ts:287-291` は provider type / base URL / api key / model の 4 キーを設定してから IIFE を呼ぶ。小 patch に縮小できる。
- いずれも `updateDomainFilterCache` を静的 import しており、置換後はこの import が不要になる可能性がある。

### 実装手順

1. 4 箇所の IIFE を全文検索で列挙し、対象が想定どおり 4 箇所であることを確認する。
2. 「IIFE 形式の呼び出しが production に残らないこと」を検証する静的テストを先に追加し、Red を確認する。
3. `src/dashboard/trancoConsent.ts:147` と `:175` を、3 キーの delta patch として seam へ置換する。
4. `src/dashboard/panels/staticForm/generalSettingsPanel.ts:291` を、4 キーの delta patch として seam へ置換する。
5. `src/dashboard/tagsPanel.ts:228` を patch 化して seam へ置換する。patch 化が難しい場合は seam の明示モードへ寄せ、理由をコメントに残す。
6. 不要になった `updateDomainFilterCache` の静的 import と `settingsRepository` の import を確認・整理する。
7. `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` と `:171` について、本 PBI で併せて delta 化するか台帳送りするかを判断し、PBI の判断記録に残す。
8. `npm run validate` と domainFilterCache 関連テストを実行する。

### 落とし穴

- seam に full-snapshot をそのまま流すと契約違反が残る。patch 化できない呼び出しは理由を明記して seam の明示モードに寄せる。
- 置換時に `updateDomainFilterCache(await getAll())` の呼び出し順を変えると、cache が保存前の値で再構築される。順序のロジックは seam 内にそのまま残す。
- `updateDomainFilterCache` の静的 import をそのまま残すと未使用 import になる。import を消すか、残す理由があるかを判断する。
- delta 抽出を大雑把に行くと、呼び出し側が組み立てた `settings` に紛れ込んだ無関係なキーまで patch に入り、意図しない上書きが発生する。
- 4 箇所を一括置換すると、どの箇所で delta 抽出が難しかったかを切り分けられない。1 箇所ずつ Red-Green で確認する。

## 決定事項

1. IIFE が production に残った理由は、PBI 2026-09-17-17 で seam が導入された際に既存呼び出しの一呼置換が含まれなかったためである。
2. 4 箇所が放置された理由は、seam の docstring が置換候補を列挙しておらず、機械的な検出手段が併せて用意されていなかったためである。
3. 静的テストが存在しないまま残存した原因は、IIFE 形式の呼び出しを全文検索で pin する仕組みがなかったためである。
4. 今是正する必要が立っている理由は、byte 同一の pasted コードが delta-write 契約の違反形態（full-snapshot による stale cache 持ち込み）をそのまま複製しているためである。
5. 4 箇所すべてを `src/utils/storage/domainFilterCache.ts:100-104` の seam へ集約し、独自経路を残さない。
6. 置換は byte 同一の挙動を維持したうえで、delta patch の抽出を個別に適用する。
7. trancoConsent 2 箇所と generalSettingsPanel は小 patch に縮小する。tagsPanel は patch 化が難しければ seam の明示モードへ寄せて理由をコメントに残す。
8. `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` と `:171` は本 PBI の対象外とし、扱いを判断して記録に残す。
9. `settingsRepository` の動的 import は Layer 0 依存グラフ維持のため維持する。

## Definition of Done

- [x] production 4 箇所の IIFE がすべて seam 経由の呼び出しへ置換されている。
- [x] 置換箇所が delta patch を渡しており、full-snapshot を setAll していない。
- [x] patch 化できない呼び出しは seam の明示モードへ寄せ、理由がコメントとして残っている。
- [x] IIFE 形式の呼び出しが production に残らないことを pin する静的テストが追加されている。
- [x] `settingsRepository` の動的 import が維持され、Layer 0 依存境界が保たれている。
- [x] `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151` と `:171` の扱いが判断として記録されている。
- [x] 保存後の cache 再構築順序が既存と同じであることをテストで確認している。
- [x] `npm run validate` と domainFilterCache 関連テストが成功している。
- [x] 既存のビルド、テスト、ユーザーに観測される動作に回帰がない。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [x] コードレビューが完了している。
