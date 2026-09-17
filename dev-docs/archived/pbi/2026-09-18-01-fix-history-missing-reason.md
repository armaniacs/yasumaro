# PBI: 履歴の診断行が欠損した理由を表示する

## ユーザーストーリー
履歴を見る人として、コンテンツ抽出やContent Cleansingの行が表示されないときに理由がほしい、なぜなら空欄では不具合か仕様か判断できず問い合わせや再記録の判断ができないから

## ビジネス価値
- 履歴パネルへの信頼を維持する。欠損を明示すれば「壊れている」という誤解を減らせる
- 測定方法: 欠損エントリで理由ラベルが表示されること、問い合わせ時の切り分け手順が不要になること

## BDD受け入れシナリオ

```gherkin
Scenario: AIなし記録のエントリで理由が表示される
  Given AI要約なしで記録した履歴がある
  When 履歴パネルでそのエントリを見る
  Then コンテンツ抽出とContent Cleansingの位置に計測なしの理由が表示される
  And トークン行は引き続き非表示のままになる

Scenario: 旧バージョン記録の部分欠損で理由が表示される
  Given 要約はあるが計測情報がない古い履歴がある
  When 履歴パネルでそのエントリを見る
  Then 欠損している行だけ理由付きで表示される
  And 存在する要約とタグ表示は従来通り表示される

Scenario: 空ページで対象なしと表示される
  Given 本文がないページの履歴がある
  When 履歴パネルでそのエントリを見る
  Then 削減率ではなく計測対象なしと表示される

Scenario: 短文や過剰削除のページは従来通り数値表示になる
  Given 短いページや広告が多いページの履歴がある
  When 履歴パネルでそのエントリを見る
  Then 理由表示ではなく従来のバイト数表示になる
```

## 受け入れ基準
- [x] バイト欠損時に行自体を消さず理由ラベルを表示する
- [x] AIなし記録と旧記録と空ページを文言で区別する
- [x] AI Summary Cleansing行の欠損時も理由表示の対象にする
- [x] プログレスバーは従来通り欠損時は非表示のままとする。理由表示の対象外である
- [x] 日英の両localeで文言が表示される
- [x] 既存の正常エントリの表示が変わらない。短文と過剰削除のfallback経路は数値表示のままにする
- [x] XSS対策として理由文言と数値のescapeを維持する
- [x] 理由ラベルは既存の診断行と同じ文字サイズとコントラストで読み取れる

## テスト戦略（t_wadaスタイル）

### テスト対象URL
外部サイトは変動するためCIには使わない。E2Eは固定fixtureのみ使う。

- 成功系: `http://localhost:8080/long-page.html`（既存、両行が数値表示される対照群）
- 短文fallback系: `http://localhost:8080/short-page.html`（本文100文字未満、`short_content`想定。数値表示のままであることの回帰ガード）
- 過剰削除fallback系: `http://localhost:8080/over-cleansed-page.html`（ナビ支配で本文極小、`over_cleansed`想定。数値表示のままであることの回帰ガード）
- 空ページ系: `http://localhost:8080/empty-body-page.html`（テキストなしcanvasのみ、計測対象なし想定）
- fixture実体: `testDir/e2e/test-pages/short-page.html`、`over-cleansed-page.html`、`empty-body-page.html`。配信は `testDir/e2e/test-pages/server.mjs` のport 8080経由

### E2Eテスト
- 上記4 URLへ遷移し履歴エントリのfallbackTriggeredとfallbackReasonが期待通り記録される
- 空ページ系で計測対象なしの理由ラベルが表示される
- 短文系と過剰削除系で理由表示ではなく数値表示になる
- AIなし記録はfixture遷移では再現しない。履歴パネルの記録なしボタン経由で別ケースとして検証する

### 統合テスト
- formatDiagnosticMetadataHtmlがViewに渡すHTMLに理由行を含む
- i18nのjaとenでkey解決できる
- fixtureページから得たExtractResultの値をseedにして理由分岐を検証する。外部URLをseedにしない
- 旧記録の部分欠損は遷移では再現しない。seedRowsでトークンありバイトなしの行を作って検証する

### 単体テスト
- page_bytesとcandidate_bytesがnullの場合に理由判定がno-measurementになる
- original_bytesとcleansed_bytesが片方だけある場合に理由判定ができる
- page_bytesが0の場合に対象なし判定になる
- sent_tokensとai_providerが共にnullの場合にAIなし記録と判定する
- AI Summary系の片欠損でも理由判定ができる
- 理由判定がescape済みHTMLを返す

## 実装アプローチ
- **Outside-In**: 受け入れシナリオに対応するViewテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2 （要チームでの見積もり）。内訳は理由判定の純粋関数と単体テストで1、View分岐とlocale追加と既存テスト更新で1。E2Eは既存fixture流用のみで追加ポイントなし

## 技術的考慮事項
- 依存関係: なし。履歴Viewの表示層のみの変更。補完側のenrichEntryWithChromeStorageとenrichRowsWithLegacyMetadataは変更しない
- テスタビリティ: formatDiagnosticMetadataHtmlは純粋関数で検証できる。locale解決はgetMessageOr経由で差し替え可能。旧記録系はseedRowsで再現しfixture遷移に頼らない
- 非機能要件: 追加クエリなし。既存entryのfield判定のみで描画するため性能影響なし。HTMLは欠損行あたり1 div増のみ
- i18n: 新規keyはhistoryNoMeasurement系に集約しjaとenの両方へ追加する。候補はhistoryNoMeasurement、historyNoMeasurementTarget、historyNoMeasurementNoAiの3 key。既存のhistoryContentExtractionとhistoryContentCleansingとhistoryAiSummaryCleansingの接頭辞に合わせる。ハードコードの日本語の秒表示には触らない
- セキュリティ: 理由文言は定数とし、数値とprovider名は従来通りescapeHtmlを通す。理由文言にURLやタイトルなどの可変値を入れない
- アクセシビリティ: 理由行は既存のhistory-entry-token-reductionと同じclassを使い、スクリーンリーダーで通常行と同様に読み上げできるようにする

## 実装者向け注記

### 現状コードの確認
着手前の必須チェックは本PBI作成時に実施済み。理由表示の実装は存在しない。沈黙的非表示のみ存在する。

```bash
grep -rn "formatDiagnosticMetadataHtml" src/
grep -rn "describeDelta" src/
grep -rn "enrichEntryWithChromeStorage" src/
grep -rn "historyContentExtraction" public/_locales/
grep -rn "historyAiSummaryCleansing" public/_locales/
```

確認結果:
- `formatDiagnosticMetadataHtml`（`src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts`）が欠損時に行を作らない。理由分岐は未実装。対象は抽出行とCleansing行とAI Summary行の3分岐
- `describeDelta`（`src/dashboard/panels/asyncData/entryByteDelta.ts`）がnullを返し、呼び出し側は行を捨てる。0以下ガードは維持する
- `enrichEntryWithChromeStorage`と`enrichRowsWithLegacyMetadata`（`src/dashboard/panels/asyncData/sqliteHistoryQuery.ts`）は今回変更しない。前者は行単位の早期return、後者は同一分バケットの最新行のみ補完の仕様を維持する
- locale keyのhistoryContentExtractionとhistoryContentCleansingとhistoryAiSummaryCleansingは存在するが、理由表示用のkeyは存在しない。historyNoMeasurement系は未登録
- `buildCleansingProgressBarHtml`（同View）はcomputeCleansingReductionがnullの場合に空文字を返す。今回は対象外とし、理由表示を追加しない
- 既存テストは `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanel-formatDiagnosticMetadata.test.ts` と `src/dashboard/panels/asyncData/__tests__/entryByteDelta.test.ts` が対象。`sqliteHistoryQuery.test.ts` は補完仕様の回帰用であり今回の変更対象外

### 実装手順
1. 理由判定の純粋関数を追加する。入力はBrowsingLogEntry、出力はno-ai-recordとlegacy-partialとempty-pageの区別。置き場所はhistoryEntryPresentation.tsが候補。View側の `??` 連鎖と二重に解決しない
2. formatDiagnosticMetadataHtmlの3分岐を反転する。抽出行とCleansing行とAI Summary行で、deltaがnullの場合に理由行を追加する。理由行は既存と同じclass名を使う
3. jaとenのmessages.jsonへ新規keyを追加する。既存のhistoryContentExtractionとhistoryContentCleansingのkey命名に合わせる
4. 既存テストを更新する。`__tests__/sqliteHistoryPanel-formatDiagnosticMetadata.test.ts` と `__tests__/entryByteDelta.test.ts` に理由表示のケースを追加する。旧記録系はseedRowsで作る
5. E2Eではテスト対象URL節の4 URLのみ使う。新規fixtureは作成済みのため追加作成は不要。しきい値（fallbackRatio=0.20、fallbackMinBytes=300）を変えた場合はover-cleansed-page.htmlの本文量を見直す

### 落とし穴
- 補完側を変えると重複行への誤帰属が起きる。表示層だけで理由を出す
- original_bytesがnullでcandidate_bytesがある場合のfallback解決はView側の `??` 連鎖を維持する。判定関数とViewで二重に解決しない
- page_bytesが0の場合は削減率を計算しない。0除算の回帰に注意する
- short-pageとover-cleansed-pageは理由表示の対象ではない。数値表示のままであることを検証する。しきい値を変えると発動しなくなる
- AIなし記録はfixture遷移では再現しない。pending記録ボタン経由で検証する
- 理由文言にURLやタイトルなどの可変値を入れない。入れるとXSSの検査範囲が広がる

## 付録: なぜなぜ分析30段階の要点
表示欠落から実装漏れまでの連鎖を30段階でたどった結果、PBIへ反映した要点のみ記す。

1. なぜ行が消えるか。Viewがnullと0を沈黙的に捨てるから。対応として理由行を追加する
2. なぜnullになるか。SQLite行にbytesがないから。対応として欠損分類を4種に分けた
3. なぜbytesがないか。記録時に送られない経路があるから。pendingのAIなし記録と旧パイプラインが該当する
4. なぜ送られないか。pending記録はcontent空とskipAiのみを送る仕様だから。E2Eをfixture遷移とpending操作に分けた
5. なぜ旧記録にないか。bytes計測が後付け機能だから。seedRowsでの再現に切り替えた
6. なぜ補完で埋まらないか。行単位の早期returnだから。今回は表示層のみ変え補完は触らないと明記した
7. なぜ最新行のみか。legacy storeがURL毎に最終訪問1件だから。重複行の空表示を理由表示で救済する方針にした
8. なぜ0が対象外か。describeDeltaの0以下ガードでInfinityとNaNを防いでいるから。ガードは維持し文言だけ変える
9. なぜshortとover_cleansedが残るか。fallback後にbytesを再計算しているから。数値表示の回帰ガードにした
10. なぜAI Summaryだけ条件が違うか。両方必須のAND条件だから。片欠損も理由対象に加えた
11. なぜprogress barが消えるか。computeCleansingReductionがnullで空文字だから。今回は対象外と明記した
12. なぜ文言を区別するか。AIなしと旧記録と空ページで次の行動が違うから。3文言に分けた
13. なぜlocaleが必要か。日英両対応が必須だから。3 keyの命名候補を固定した
14. なぜXSSに注意するか。理由行もHTML文字列結合だから。定数文言とescape維持を条件にした
15. なぜa11yが必要か。診断行が情報だから。既存classの再利用を指定した
16. なぜ外部URLを使わないか。変動でCIが壊れるから。固定fixtureのみに限定した
17. なぜ4 URLか。成功対照と3失敗分類を分けるため。期待表示をURL毎に固定した
18. なぜしきい値に注意するか。fallbackRatioとfallbackMinBytesで発動が変わるから。見直し条件を記載した
19. なぜBDDを4件にしたか。短文と過剰削除の正常表示を保証しないと過剰な理由表示が混入するから。4件目を追加した
20. なぜ技術用語をBDDから除いたか。ステークホルダー言語にするため。page_bytes表現を本文がないと言い換えた
21. なぜ見積もりを分けたか。判定関数とViewで作業が分かれるから。1と1に分けた
22. なぜ補完テストを対象外にしたか。仕様変更なしの回帰用だから。sqliteHistoryQuery.test.tsを対象外と明記した
23. なぜ行番号ではなく関数名にしたか。行番号は変動するから。関数名基準に変えた
24. なぜ秒表示に触らないか。既存のハードコードと混ざるから。対象外と明記した
25. なぜ可変値を入れないか。検査範囲が広がるから。禁止事項にした
26. なぜ二重解決を禁じるか。Viewと判定でずれが起きるから。Viewの連鎖維持を指定した
27. なぜ0除算に注意するか。過去のInfinityバグの再発になるから。計算しない方針を明記した
28. なぜrollbackが必要か。表示変更でも誤表示の可能性があるから。手段をDoDの条件にした
29. なぜdocs更新先が必要か。対象不明だと残るから。履歴パネル関連の更新を指定した
30. なぜINDEX更新が必要か。pbi配下の運用規則だから。完了時にINDEX反映を指定した

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了（/review uncommitted で APPROVE。XSSescape維持を確認済み）
- [x] リファクタリング完了（グリーン後）
- [x] ロールバック手段の検討（表示層のみの変更のため、理由行の追加分岐をrevertすれば従来表示に戻る。locale key追加は残しても無害）
- [x] ドキュメント更新済み（Phase 4 の CHANGELOG に理由表示の文言と3分類を記載する）
- [x] pbi/00-INDEX.mdに本PBIの行を追加する（アーカイブ履歴への1行追記で代替）
