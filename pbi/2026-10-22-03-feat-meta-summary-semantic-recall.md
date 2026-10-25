# PBI: 想起化 ― メタ要約と意味的類似のローカル統合

## ユーザーストーリー
調べ物をする人として、週の読み物を1枚にまとめ直し、似た記事を1か所で見比べたい、なぜなら5媒体で同じニュースを5行残されても振り返れないから

## 優先度
- 順位: 03 / 6候補
- RICEスコア: 427 (Reach=800 / Impact=2 / Confidence=0.8 / Effort=3.0人週)
- 根拠: 体感価値が最大の想起機能。E1/E6相当。Effort大のためPBI 01の後に置く
- 依存: PBI 01に依存(Provider catalogとストレージSSOTの上で組む)。単独先行はdriftを生むため非推奨

## 背景・制約
- 外部送信なしを第一にし、ローカルWASMのembeddingから始める。FTS5 trigramは残し、ハイブリッド検索(FTS+ベクトル)にする
- 週次/月次ダイジェストはバッチジョブ化し、SW殺害・Offscreen短命に耐える設計にする
- `EXPORT_COLUMNS` 固定・タグ5000件over-fetch等の既知制約と干渉させない。列追加は互換方針の見直しとセットにする
- なぜなぜ分析の解: 表面的要望「CSVがほしい」の裏は「振り返り自動化」。本PBIはエクスポートではなく想起の自動化として書く

## BDD受け入れシナリオ
Scenario: 週次ダイジェストが生成される
  Given 1週間の記録が10件以上ある
  When 週次バッチを実行した
  Then カテゴリ別の要約が1件生成されDaily Noteに追記できる

Scenario: 類似記事が束ねられる
  Given 同一ニュースを複数媒体で記録した
  When 類似クラスタ表示を開いた
  Then 1クラスタに束ねられ、鮮度(最終更新)と多角的差分だけが見える

## 受け入れ基準
- [ ] 外部APIなしで類似判定ができる(ローカル実行)
- [ ] 日本語クエリでハイブリッド検索がFTS単体より再現率で上回る(評価コーパス固定)
- [ ] ダイジェスト生成中も記録パイプラインが止まらない
- [ ] クラスタ操作は取り消し可能で元記録を壊さない

## テスト戦略
## 実装記録（2026-10-23・類似クラスタの語彙土台）
- 類似クラスタ集計: 完了。`src/dashboard/similarityClusterAggregate.ts` の `buildSimilarityClusters` が同一ニュースの複数媒体記録を1クラスタに束ねる。鮮度(freshestAt=最終更新)と多角的差分(domains=媒体一覧)だけを返す。クラス内は訪問順、クラスタは件数降順。検索語なしの依存: PBI 01のSSOT確定済みのため本スライスは01の作法(Provider catalog・ストレージSSOT)に従い新規キーは追加しない
- 語彙土台の正直な範囲: リポジトリにWASM embedding資産が未存在のため、本スライスはタイトル語彙Jaccard(完全ローカル・外部APIなし)で受入基準「外部APIなしで類似判定ができる」を満たす。embedding選定とハイブリッドFTS+ベクトル順位統合は後続スライス(本モジュールのしきい値テーブルとクラスタ形状が差し込み口)
- 縮退の出口: タイトル欠落は参加せず、単独行は破棄(MIN_CLUSTER_SIZE=2)。空集合は空配列(例外なし)
- 非破壊: 純粋関数のみ。入力記録を変異させない(クラスタ操作は取り消し可能で元記録を壊さない)。テストで入力不変をpin
- pin: `src/dashboard/__tests__/similarityClusterAggregate.test.ts` 6テスト(語彙化・しきい値境界・媒体横断の束ね・鮮度と差分・縮退・件数順・入力不変)
- 残: クラスタ表示のパネル配線、週次ダイジェストのバッチジョブ化(SW殺害・Offscreen短命耐性)、embedding選定とハイブリッド順位統合、再現率の評価コーパス、E2E通し、コードレビュー、ドキュメント更新(評価コーパスと再現手順)
- E2E: 記録→バッチ→ダイジェスト追記→クラスタ表示の通し
- 統合: FTS+ベクトルの順位統合テスト、バッチ再実行の冪等性テスト
- 単体: 類似しきい値・切り詰め・空集合の境界テスト

## 見積もり
3.0人週相当。embedding選定で変動するためチームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(評価コーパスと再現手順を含む)

## 実装記録（2026-10-25・スライス2: パネル配線・バッチ・ハイブリッド・評価土台）
- 新規モジュール: `src/dashboard/semanticVector.ts`、`src/dashboard/hybridRecallRank.ts`、`src/dashboard/evalCorpus.ts`、`src/dashboard/recallEval.ts`、`src/dashboard/similarityClusterPanel.ts`、`src/background/digestBatchJob.ts`。テスト6ファイル計31テスト。外部APIなし・ローカルのみ。`any`/`unknown` は src・テストとも不使用。ESM `.js` import。固定時間待ちなし
- (a) クラスタ表示: 完了(配線の芯まで)。`buildClusterPanelModel` がクラスタを見出し(件数・媒体・鮮度)+行(題・媒体・link)の表示モデルに写す。`renderClusterPanel` は textContent/setAttribute のみ(CSP: innerHTMLなし)。非破壊: モデルは複写、解除は自コンテナの節だけ消す(元記録不変をテストでpin)。取消可能: fetch→isStale確認→描画の約束を既定の `asyncDataPanelLifecycle` 側に寄せる設計。開: カタログ登録・HTML・実パネル生成は未配線(共有の `panelCatalog.ts`/`panelFactories.ts`/`index.html` に触れるため別スライス)
- (b) 週次ダイジェストのバッチ: 完了(再開の芯まで)。`runDigestBatch` は1呼び出し=1チャンク(既定の5分再試行アラーム等の短周期tickから呼ぶ想定)。進捗は注入の `DigestCheckpointStore` に書く(chrome.storage.local想定。メモリ禁止: SWと共に死ぬ)。`{periodKey, nextIndex, processedIds}` の検査点+完了標識の単一原子書込で冪等再開。kill後の次tickは検査点から続行(週次アラーム待ちに戻らない)。記録パイプライン不接触(共有mutex・共有キーなし)。開: `alarmRegistry.ts` への行追加と `reviewSummaryGenerator` との結合(既存週次標識 `REVIEW_SUMMARY_LAST_GENERATED_WEEK` との二重化整理)は未実施
- (c) embedding選定: 下のなぜなぜ分析により「学習済み模型なし・WASM新規なし・文字1-3gram集合+cosine」をv1に選定。FTS5 trigramを残し順位統合はRRF(`hybridRecallRank.ts`、既定 fts 0.6/vec 0.4/k 60)。FTS圏外文書は最下位(N+1)扱いで意味的強一致が浮上できる形。否定的測定も記録: 15件級の小コーパスでは融合はFTS順とほぼ同一(MRR一致)。重み再調整は大規模判定コーパス待ち
- (d) 評価コーパス: 固定。`evalCorpus.ts` に15文書(12主題+近似的外れ3)・日本語4問・関連判定を凍結。`evaluateRecallAt3` はFTS単体(文字gram重なり順: 実FTS5 trigram MATCHの近似)とハイブリッドの recall@3+MRR を出す。測定(2026-10-25): recall@3 はFTS 1.0・hybrid 1.0、MRRは0.576・0.576で同点。非退行(hybridHolds)は成立。受入基準「FTS単体を上回る」の厳密超過は未達(正直な開きとして残す)
- (e) E2E: 未実施(理由は verdict 節)。将来手順は docs draft に記載
- (f) コードレビュー: 敵対的自己レビュー(攻撃者/保守者の2視点+反証)を実施。指摘3件を修正: 非http(s) URLの無害化(`similarityClusterPanel.ts`、link化は `https?` のみ・他は不活性文)、日付表示の利用者 locale 化、融合・再開の拡張注記。残る軽微所見は verdict 節
- (g) docs draft: 最終報告に同封(評価コーパス・再現手順・将来E2E手順を含む)

### なぜなぜ分析(embedding選定: 利用者/保守者/攻撃者の3立場×5問)
- 立場1・利用者。Q1 なぜJaccardでは足りないか―表記ゆれ(かな・かな以外・略語)に弱いから。Q2 なぜ表記ゆれが痛いか―週次クエリは2-4語の短文で1語の不一致が致命傷だから。Q3 なぜ短文が前提か―想起は探す行為で整文ではないから。Q4 なぜ整文でないと困るか―形態素解析の誤りが順位を直接壊すから。Q5 なぜ誤りに弱い設計を避けるか―辞書なしで動く部分文字列重なりが日本語無区切りに一律に効くから。結論: 文字gram集合+cosine(辞書・模型・通信なし)
- 立場2・保守者。Q1 なぜ新規WASMクレートを作らないか― crates.json の審査・parity suite・30KB超資産・postprocess配線が要るから。Q2 なぜ既存4クレートの流用でないか―pii/textrank/tag-cooccurは責務が違い sentence-dedupは判定APIで向量を出さないから。Q3 なぜ流用が悪いか―想起の順位と重複除去の敷居値を結合させ将来の調整が互いを壊すから。Q4 なぜ結合が怖いか―敷居値の意味が2責務で二重化し試験が偽陽性を生むから。Q5 なぜ純TSか―jsdom/vitestでwasm-packなしに試験でき依存の芽を残さないから。結論: 依存なし純TS向量(将来の模型差し替え口は `vectorizeSemanticText` の型に集約)
- 立場3・攻撃者。Q1 外部APIが禁じられる理由―閲覧全文の外部送信は漏えい面そのものだから。Q2 模型配布物の危険―供給連鎖への署名外依存と取得時通信が増えるから。Q3 ハッシュ固定次元の危険―短クエリで衝突優勢となり順位が雑音化するから(実測: q-resumeで関連2件が向量側8-9位に沈み融合top3から脱落)。Q4 なぜ正確集合に戻したか―題+要約は最大200要素級で固定次元の節約益がなく衝突損だけ残るから。Q5 なぜ1-3gramか―2字熟語(冪等・再開)が3gram単独では一致不能で日本語想起の単位に届かないから。結論: 正確な文字1-3gram集合(決定論的・通信なし・永続向量なし)
- 選定理由の要約: ローカルのみ・資産なし・決定論的・試験容易の4点を満たす唯一肢が文字1-3gram集合+cosine。否定的知見(小規模ではFTSと同点・真の類義語には届かない)も受入判断材料として残す

### なぜなぜ分析(バッチ耐性: 仕様/実装/運用の3観点×5問)
- 観点1・仕様。Q1 なぜ週次アラームだけでは駄目か―実行中killが次の月曜まで再走しないから。Q2 なぜ再走間隔が問題か―週次物の遅延上限は分単位であるべきだから。Q3 なぜ短周期tickか―既存5分再試行の前例がありSW再起と相性が良いから。Q4 なぜ検査点か―SW死は記憶死で storageだけが生き残るから。Q5 なぜ標識を単一書込か―Daily Note追記の二重化だけが利用者可視の破壊だから。結論: 短周期tick+storage検査点+完了標識の単一原子書込
- 観点2・実装。Q1 なぜ既存生成器を直接使わないか―全期間を1寿命で処理しkillで零に戻るから。Q2 なぜ塊分割か―1tickの仕事をSW寿命内に収めるため。Q3 なぜ部分要約を保存しないか―要約全文は quota 級に育ち storage.local を圧迫するから(検査点はid列のみ)。Q4 なぜ再開時に畳み直すか―要約は冪等な畳み込みで再計算が単純だから。Q5 なぜ記録路に触れないか―共有mutexが停止波及の経路になるから。結論: id列検査点+畳み直し再開+記録路不接触
- 観点3・運用。Q1 なぜ他期間の検査点を捨てるか―週跨ぎの古い進捗の継続は誤追記だから。Q2 なぜ発行失敗で標識を書かないか―再付与で重複なく続けられるから。Q3 なぜ塊量に下限助言(200以上)か―再開の畳み直しが O(件数)×tick数で増えるから。Q4 なぜ停止判定(isStale)を畳み中に見るか―新走が旧走の描画・発行を上書きしないため。Q5 なぜ設定再読込を残すか―同意撤回後の塊継続は送信系と同じ過ちだから(結合時に `isConsentGranted` 再読を組む)。結論: 上記5則を結合時の受入条件にする

### per-box verdicts(証拠つき)
- DONE(前回): `src/dashboard/similarityClusterAggregate.ts:82-117` + `src/dashboard/__tests__/similarityClusterAggregate.test.ts`(6)
- (a) verdict: 芯完了・登録開。証拠 `src/dashboard/similarityClusterPanel.ts:43-75`(模型)・`:89-138`(描画)・`src/dashboard/__tests__/similarityClusterPanel.test.ts`(6: 束ね・縮退文言・不変・描画と解除・空・URL無害化)。開きの最小片: カタログ1行+HTML節+生成1関数
- (b) verdict: 芯完了・結合開。証拠 `src/background/digestBatchJob.ts:62-121`(塊・検査点・標識・停止)・`src/background/__tests__/digestBatchJob.test.ts`(5: 分割再開・冪等・発行失敗・取消・他期間破棄)。開きの最小片: alarm表1行+ `REVIEW_SUMMARY_LAST_GENERATED_WEEK` との標識統一
- (c) verdict: v1選定完了・厳密超過の検証は開。証拠 `src/dashboard/semanticVector.ts:1-62`・`src/dashboard/hybridRecallRank.ts`・`src/dashboard/__tests__/semanticVector.test.ts`(6)・`src/dashboard/__tests__/hybridRecallRank.test.ts`(4)
- (d) verdict: 土台完了・厳密超過は開。証拠 `src/dashboard/evalCorpus.ts`(15文書・4問)・`src/dashboard/recallEval.ts:54-84`(recall@3+MRR)・`src/dashboard/__tests__/recallEval.test.ts`(3: 凍結・決定論・非退行)。測定値は上記
- (e) verdict: 未実施。理由: 新規面(未登録パネル・未結合アラーム)は現distに存在せず、再buildは本作業の禁止事項のため headless 実行の対象物がない。最小片: (a)(b)の登録結合後に `testDir/e2e/` へ1 spec(手順はdocs draft)
- (f) verdict: 自己レビュー完了・第三者レビュー開。所見は本記録と最終報告
- (g) verdict: draft同封(最終報告)。`docs/` 本体には触れず(制約)
