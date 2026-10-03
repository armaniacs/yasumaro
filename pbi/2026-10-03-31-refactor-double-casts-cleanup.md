# PBI: 残存 `as unknown as` 二段キャストの整理

## ユーザーストーリー

保守者として、production コードに残った `as unknown as` 二段キャストを単一キャストまたは型ガード付きの狭めに置き換えたい。二段キャストはコンパイラの型検査を迂回して誤った型を隠すため、実行時バグの温床になるからだ。

## 優先度

- 種別: refactor
- 順位: 16 / 20
- RICEスコア: 4.0（Reach=4 / Impact=0.5 / Confidence=1.0 / Effort=0.5）
- 根拠: 型検査迂回の残骸は発見的負債で実害は未観測。単一キャストで済む箇所が大半のため変更は機械的。
- 依存: rank-10 statusPanel 分割 + rank-07 STATUS_CLASS の後。`src/popup/statusPanel.ts:29` はこの 2 PBI が触る同一領域のため、先行 PBI 完了まで着手しない。

## 背景

- `src/dashboard/tagClusterTimeSliderPanel.ts:471,478`: `as unknown as SVGSVGElement` 系の二段。単一の `querySelector<SVGSVGElement>` で十分。近隣 `:460` のコメントが単一キャスト規則を説明している。
- `src/dashboard/aiSummaryCleansingSettingsV2.ts:162,211`: `settings as unknown as Record<string,boolean>` が typeof チェックなし。`Record<string,unknown>` に受けて要素ごとに narrow する。
- `src/utils/encryptedBackupService.ts:98`: unknown → unknown の二段で意味がない。
- `src/popup/statusPanel.ts:29`: `null as unknown as ...` → `= undefined` に置換。
- `src/utils/whitelistWriter.ts:68`: `as unknown as Settings` は不要。`setAll` は `Partial<SettingsType>` を受け付ける（`:214`）。
- `src/messaging/types.ts:385-386`: 二段キャスト。
- `src/content/visitGating.ts:227-229`: 3 段チェーン。
- `src/popup/previewPresenter.ts:202,205,252`: `as HTMLDialogElement` への置換で十分。
- 除外: `src/background/sqliteWireTable.ts:149,160,276` は wire 層固有のキャストで本 PBI の対象外（低優先度、別途検討）。

## BDD受け入れシナリオ

```gherkin
Scenario: 二段キャストを単一キャストへ置き換えても検証が成功する
  Given production コードに `as unknown as` が残存している
  When 対象箇所を単一キャスト、querySelector 総称呼び出し、または = undefined へ置き換える
  Then 型エラーなく npm run validate が成功する
  And 置き換えた箇所の実行時挙動に変化がない

Scenario: 型を狭める際は検査を省略しない
  Given `aiSummaryCleansingSettingsV2.ts` の settings が Record<string,unknown> で受ける
  When 要素を使う箇所で typeof による narrow を追加する
  Then 二段キャストは消え、不正な型値は narrow で弾かれる
  And コンパイラが要素型の誤りを検出できる
```

## 受け入れ基準

- [ ] 対象 7 ファイル（tagClusterTimeSliderPanel / aiSummaryCleansingSettingsV2 / encryptedBackupService / statusPanel / whitelistWriter / messaging/types / visitGating / previewPresenter）の指定箇所から `as unknown as` が消えている。
- [ ] `aiSummaryCleansingSettingsV2.ts` の置き換えには typeof による narrow が付いている。
- [ ] `statusPanel.ts:29` は `= undefined` で置換され、rank-10 / rank-07 の変更と競合していない。
- [ ] `whitelistWriter.ts:68` は `setAll` のシグネチャを確認した上でキャスト削除している。
- [ ] `sqliteWireTable.ts` は本 PBI で変更していない。
- [ ] `npm run validate` が成功している。
- [ ] production の動作に回帰がない。

## テスト戦略

### 単体テスト

- 既存テストを基準に、キャスト置き換え前後で結果が変わらないことを確認する。
- `aiSummaryCleansingSettingsV2` の narrow 追加箇所は、不正型が弾かれるケースを追加検証する。

### 統合テスト

- `npm run validate`（type-check + test）をゲートとし、型エラーが無いことを外部から確認する。
- `grep -rn "as unknown as" src/ --include="*.ts"` で、対象ファイルからの残存が 0 であることを確認する。

## 見積もり

**0.5 SP**

単一キャスト・querySelector・undefined 置換が主体の機械的変更。narrow 追加は 2 箇所のみ。

## Definition of Done

- [ ] 指定箇所の二段キャストがすべて解消されている。
- [ ] 除外対象（sqliteWireTable.ts）を変更していない。
- [ ] `npm run validate` が成功している。
- [ ] 既存のビルド・テスト・ユーザーに観測される動作に回帰がない。
- [ ] rank-10 / rank-07 との統合順序が確定している。
