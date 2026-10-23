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
- [ ] コレクションを対象に選べる
- [ ] 答えに引用リンクが付く
- [ ] 該当なし時に作らない応答になる
- [ ] 縮退・失敗の理由表示と再試行ができる

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
- pin: `src/dashboard/panels/asyncData/__tests__/askHistoryPanelView` なし（DOM層はE2Eで検証）
- 残: E2E通し（コレクション選択→質問→引用遷移）、FTS/LIKE両パスの統合スニペット再現テスト、コードレビュー、ドキュメント更新（QAの使い方と対象指定を含む）
- E2E: コレクション選択→質問→引用遷移の通し
- 統合: FTS/LIKE両パスのスニペット再現テスト、空集合テスト
- 単体: 引用整形・打ち切り・安全性判定のテーブルテスト

## 見積もり
2.5人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(QAの使い方と対象指定を含む)
