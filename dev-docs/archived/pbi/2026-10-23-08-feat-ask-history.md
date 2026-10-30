# PBI: 履歴に聞く ― 引用付きローカルQA

## ユーザーストーリー
調べ物をする人として、溜めた記録に言葉で聞きたい、なぜなら検索語を思い出せないと知識が眠ったままになるから

## 優先度
- 順位: 03 / 5候補
- RICEスコア: 448 (Reach=700 / Impact=2 / Confidence=0.8 / Effort=2.5人週)
- 根拠: M2の保存条件を入力にする。M2確定後に着手する
- 依存: PBI 2026-10-23-06(M2)に依存する。PBI 2026-10-23-01のegress作法に従うこと

## 背景・制約
- `reviewSummaryGenerator` の集計→生成の型と `ProviderStrategy`(`src/background/ai/providers/`)を流用する
- 外部送信なしの Built-in/local から始め、FTSスニペット付きで根拠3件のリンクを返す。PIIマスキングとプライベート除外を全経路に適用する
- 3バックエンド対応(FTS/LIKE分岐・縮退表示)をM2の作法に合わせる。新規集計の追加はM2の永続化に乗せる

## BDD受け入れシナリオ
Scenario: 質問に引用付きで答える
  Given 対象コレクションを選んだ
  When 質問を投げた
  Then 答えと根拠3件のリンクが返り、元記録に飛べる

Scenario: 根拠がないときは分からないと言う
  Given 該当記録がない質問である
  When 質問を投げた
  Then 作らず分からないと答え、対象の広げ方を提案する

## 受け入れ基準
- [x] コレクションを対象に選べる（2026-10-26確認: ハンドラ事後絞りと未知id無絞り縮退を単体でpin、select描画をviewテストでpin、panelはloadSaved完了後の再描画に修正。E2Eは作成済み・headed未実行）
- [x] 答えに引用リンクが付く（2026-10-25確認: 上位3件・500字打切り・target=_blank＋noopenerを単体とviewテストでpin）
- [x] 該当なし時に作らない応答になる（2026-10-25確認: AI不呼出しと広げ方提案を単体でpin、gateway透過もpin）
- [x] 縮退・失敗の理由表示と再試行ができる（2026-10-26: in_flight・未知id縮退・sqlite Narrowing・timeoutはpin済み。再試行はボタン復帰で可能。admission拒否のreason透過は [2026-10-25-12-gateway-reason-fidelity.md](2026-10-25-12-gateway-reason-fidelity.md) で解決：handlerがreasonをerrorに写し、gateway透過・viewの translated error表示まで鎖を確認。失敗表示はviewテストでpin済み）

## テスト戦略
## 実装記録（2026-10-23・コアQA経路）
- ハンドラ: 完了。`src/background/handlers/askHistoryHandlers.ts` の `createAskHistoryHandler` が根拠検索→コレクション絞り→ドメインポリシー除外→ローカル回答→引用返却を集約。ハンドラローカル in-flight guard（実行中の再クリックは in_flight 応答）
- 根拠選択: 完了。`pickEvidenceRows`（上位3件・`no-summary` ドメイン除外・引用できる本文がない行はスキップ）+ `truncateSnippet`（500字打ち切り）。スニペットは記録経路が保存したクレンジング済み本文（PIIマスク済み）から引用する never-raw ルール（生のページ本文は対象外）
- コレクション対象: 完了。FTS/LIKE検索opにタグ・期間パラメータがないため、`matchesCollectionScope` が検索行を事後絞り（タグ所属・ローカル日付範囲）。未知のidは `loadCollection` が null を返し無対象絞りに縮退（縮退の出口: 失敗ではなく無絞り検索にフォールバック）
- 該当なし分岐: 完了。`status: 'no_evidence'` で対象の広げ方を返す（`buildWidenSuggestion`: 検索語を短く/要約が生成された記録を対象に/ドメイン対象外）。根拠がないときはAIを呼ばず作らない（BDD: 作らず分からないと言う）
- 外部送信なし: 完了。AI seamに `mode: 'local_only'` を強制（FallbackAIServiceが端末内モデルのみに経路、リモートプロバイダに到達しない）。consent は admission の `ask` kind で実行時に再読込（`recordingAdmission.ts` に kind と 'ask' バケットを追加。ダッシュボードのQA連打がポップアップの記録を奪わない）
- messaging: 完了。`ASK_HISTORY` 型（messageTypes.ts・ResponseForType）・`AskHistoryValidator`（質問は `MAX_SEARCH_QUERY_LENGTH` と同cap）・`src/messaging/askHistoryGateway.ts`（60秒budget・regenerateSummaryGatewayと同形）・MessageRouter登録（trust: extension-only）・composition配線（`askEvidenceSearch` = 背景sqlite search seam、SqliteErrorはユーザー向け文に絞る）
- ダッシュボードUI: 完了。`src/dashboard/panels/asyncData/askHistoryPanelView.ts` の `renderAskHistoryRegion`（対象コレクションselect・質問入力・聞くボタン・回答+引用リンク領域）。shell の `sqlite-ask-history` 領域 div は buildPanelShellHtml が所有。回答の引用リンクは `target="_blank" rel="noopener noreferrer"` で元記録に飛べる（BDD: 元記録に飛べる）
- ja/en: `askHistoryLabel`・`askHistoryHelp`・`askHistoryTargetLabel`・`askHistoryTargetAll`・`askHistoryQuestionPlaceholder`・`askHistoryAskBtn`・`askHistoryBusy`・`askHistoryFailed`・`askHistoryNoEvidence` の9キーを双側追加
- pin: `src/background/handlers/__tests__/askHistoryHandlers.test.ts` 20テスト（根拠選択テーブル・打ち切り・縮退・コレクション絞り・BDD2シナリオ・in-flight・admission拒否）。既存 pin 更新: MessageRouter handler数 25→26、senderTrustCoverage に ASK_HISTORY 追加
- pin: `src/dashboard/panels/asyncData/__tests__/askHistoryPanelView.test.ts` 4件（対象select描画・回答と引用リンク・no_evidence・失敗表示。2026-10-25追加、当初はDOM層E2Eのみの予定を変更）
- 残(2026-10-30更新): E2Eは作成済み（testDir/e2e/ask-history.spec.ts 3件。no-evidence 1件がextensionで緑、回答系2件は実機モデル必須のため `@interaction`）。FTS/LIKE両パスの実sqlite統合テストは完了(下記追記)。コードレビューは完了。ドキュメントは反映済み
- E2E: コレクション選択→質問→引用遷移の通し(回答系2件は実機モデル必須のowner手動。no-evidence 1件は緑)
- 統合: FTS/LIKE両パスのスニペット再現テスト(完了・下記追記)、空集合テスト(単体でpin済み)
- 単体: 引用整形・打ち切り・安全性判定のテーブルテスト(pin済み、askEvidence.test.ts＋askHistoryPanelView.test.ts)
- 追記(2026-10-25・検証と小gap修正):
  - 修正F1: MessageRouterのASK_HISTORY配線がaiService.generateSummaryを未束縛で渡し、回答成功経路が毎回TypeErrorになっていた。束縛arrowに修正。回帰テストをaskHistoryHandlers.test.tsに追加(実router＋this依存aiServiceでansweredを検証。修正前は失敗・修正後は成功を確認)
  - 修正F2: panel load()がvoid loadSaved()の完了を待たずask領域を描画し、対象selectが初回常に空になっていた。loadSaved完了後にask領域を再描画する形に修正（当初のawait直列化は生成レースガードの単体テストを hang させたため、model fetchを塞がない .then 再描画に変更。2026-10-26）。viewテストで選択肢描画をpin
  - 追加テスト: askHistoryPanelView.test.ts 4件(選択肢・回答と引用リンク・no_evidence・失敗表示)。単体とviewは全パス、型検査とeslintも clean
  - レビュー所見(2026-10-25): 層分離(askEvidence純粋化)・never-raw・fail-closed・egress作法(local_only＋ask kind＋no-summary除外)・validator上限・trust設定は良好。規約違反なし(any/unknownなし、ESM .js、固定待ちなし)。R3(拒否reasonの欠落)は契約変更につき別PBI送り、R4(30件取得上限の黙示切捨て)は既知の近似として記録のみ
- 追記(2026-10-30・統合テスト完了): `src/offscreen/__tests__/askHistoryEvidence.realEngine.test.ts` 16テスト、実better-sqlite3上でハンドラ通し=wire fold→planQueryOrSearch→handleSearch→実SQL。パス判定discriminator(3字以上→FTS・2字→LIKE)もpin。500字境界・上位3件・引用不能行スキップ・no-summary除外・タグ事後絞り・no_evidenceを両パスで実証、`--repeats=20` green、eslint/型検査 clean。本番コード変更なし
- 言い回し合わせ(2026-10-30): 検索投影(`SEARCH_COLUMNS_WITH_RANK`、FTS/LIKE両SELECT)は `content` を含まないため、実sqlite経路のスニペットは永続化済みクレンジング済み **summary** から派生する(本文からの引用は hand-built row のみで到達)。never-raw ルール(生本文を送らない)は満たす。content のみに検索語がある記録は QA の対象外(検索対象は url/title/summary/tags)。上記の「クレンジング済み本文（PIIマスク済み）から引用する」記述は summary 由来が実態として読み替える

## 見積もり
2.5人週相当。チームで再見積もりすること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（2026-10-30: 単体（evidence 11 件+FTS/LIKE 実エンジン 428 行・rank 射影 2 pin）・view緑、E2E は no-evidence 1 件が extension で緑。回答系 2 件は実機モデル必須のため `@interaction` に再タグ（built-in-ai 既存 spec と同扱い）で owner 手動に委ねる ― 自動化不能項目として明示）
- [x] コードレビュー完了（2026-10-25実施: 対象commit e02992f7ほか。P0未束縛generateSummaryとP1コレクション競合を修正、P2 reason欠落は別PBI送り。詳細は実装記録の追記節）
- [x] ドキュメント更新済み(QAの使い方と対象指定を含む)（2026-10-25: `docs/SETUP_GUIDE.md` の履歴に聞く欄に再試行・60秒・二重実行防止を追記）

## 実装記録（2026-10-30・完了確認とアーカイブ）
✅ 2026-10-30: 自動化可能部分の完了を確認してアーカイブ。コア QA 経路（`e02992f7`、単体 16 件）+ FTS/LIKE 実エンジン統合テスト（`94d59649`、428 行 11 件: FTS 5 トライグラム経路と LIKE 経路の振り分け・rank 射影 2 pin・per-kind 統計）+ P0/P1 レビュー指摘修正済み（未束縛 generateSummary・loadSaved コレクション競合、P2 reason 欠落は別 PBI 2026-10-25-12 で解決済み）。検証: 変更テスト green（evidence 11 件は型返済後に 10 回連続 green・フルスイート 1203 files/17595 tests green）、`make clean test` exit 0。残した開き: 回答系 2 件の headed E2E（実機モデル必須・`@interaction` タグ・built-in-ai 既存 spec と同扱い）は owner 手動に委ねる。QA の問い方・対象指定の使い方は `docs/SETUP_GUIDE.md` に反映済み
