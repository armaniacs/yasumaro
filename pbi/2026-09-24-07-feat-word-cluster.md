# PBI: ワードクラスタ分析

## ユーザーストーリー
タグを付けないユーザーとして、summary と title から抽出したキーワードの共起クラスタグラフをダッシュボードで見たい、なぜなら自分が何を見てきたかの俯瞰をタグ付けなしで得たいから

## 優先度
- 順位: 着手順 07（RICE順位 10 → 昇格 / 13候補中）
- RICEスコア: 1.33（Reach=4 / Impact=2.0 / Confidence=50% / Effort=3pt）
- 根拠: RICEは低めだがユーザーが本日明示要求した機能のため昇格した。Confidence 50% の理由は日本語キーワード抽出品質が未検証であることであり、STEP 0 の実データによる手動プローブでストップワードと閾値を調整することで軽減する。タグを付けないユーザーにも俯瞰価値を届ける新価値があり、既存タグ共起パイプラインの再利用により共起計算と描画は低コストで実現できる。

## BDD受け入れシナリオ
Scenario: キーワード共起クラスタの表示（ハッピーパス）
  Given 期間内に summary と title を持つログが複数件存在する
  When ユーザーがダッシュボードのワードクラスタパネルを開き期間を選択する
  Then Intl.Segmenter ベースで抽出されたキーワードの共起クラスタグラフが force layout SVG で表示される
  And pan と zoom 操作ができる
  And 除外件数（AI 失敗行とフォールバック文字列行）が画面に表示される

Scenario: summary が全て利用不可の場合
  Given 対象期間の全行の summary が null またはフォールバック文字列のみである
  When ユーザーがワードクラスタパネルを開く
  Then title のみからキーワード抽出を試み、抽出結果が 0 件の場合は空状態メッセージが表示される
  And グラフ描画処理は実行されずエラーにならない

Scenario: 日本語と英語が混在するテキスト
  Given 日本語と英語が混在する summary と title が存在する
  When キーワード抽出が実行される
  Then 両言語のキーワードが共起集計に含まれ、ストップワードと最小長未満の語は除外される

Scenario: 同一キーワードの大量出現と cap 動作
  Given 同一キーワードが多数のレコードに出現する
  When 共起集計が実行される
  Then 1レコードあたりのキーワード数は 50 件で打ち切られ、クラスタ対象タグ数は 50 件で打ち切られる
  And 処理がタイムアウトせず完了する

Scenario: 上限 10000 行での期間フィルタ
  Given 対象期間のログが 10000 行を超える
  When queryLogs に since と until を指定して取得する
  Then SQL 側で期間フィルタされ上限 10000 行で打ち切って集計される
  And 打ち切りが発生したことが画面表示で分かる

## 受け入れ基準
- [ ] STEP 0 として実データ（ユーザー自身のDB）で日本語キーワード抽出品質の手動プローブを実施し、ストップワードと最小長閾値を調整した結果が記録されている（※ リポジトリからユーザーの実 DB にはアクセス不可のため自動化不可。合成 JA/EN コーパスによる自動 sanity プローブは実装済み — 実データでの手動プローブとチューニングはユーザー検証として残置）
- [x] summary と title を入力とするキーワード抽出層が Intl.Segmenter（granularity:'word'）とストップワードフィルタと最小長フィルタと 1 レコードあたり 50 件 cap で動作する
- [x] 抽出キーワードを既存共起パイプラインに渡すアダプタにより、タグクラスタと同一の force layout SVG と pan と zoom で表示される
- [x] 'Summary not available.' のフォールバック文字列行と summary null の AI 失敗行が集計から除外され、除外件数が画面に表示される
- [x] 共有期間フィルタ部品による since と until の期間指定が SQL 側で反映され、上限 10000 行で打ち切られる
- [x] content カラムは v1 の集計対象外であり、参照も取得も行わない
- [x] クリック遷移は v1 では無効または検索遷移のいずれかに統一されている
- [x] 日英両言語の UI 文言と空状態表示が提供され、WCAG 2.1 AA を満たす

## テスト戦略
- E2E: ダッシュボードのワードクラスタパネルを開き、期間選択から SVG グラフ表示と除外件数表示までを確認する。summary 全 null 時の空状態表示を確認する。
- 統合: queryLogs の since と until による期間フィルタと 10000 行 cap、アダプタから computeTagCooccurrenceHybrid と computeLayout を経て SVG 描画に至る経路を確認する。共有期間フィルタ部品との連携を確認する。
- 単体: キーワード抽出層を重点的に検証する。全てストップワードまたは短すぎて抽出 0 件になる場合、summary 全 null の除外、日本語と英語混在の分割、同一キーワード大量出現時の 1 レコード 50 件 cap、フォールバック文字列の除外を検証する。

## 実装メモ
- テキスト入力の前提: summary は PII サニタイズ後の AI 生成要約で nullable であり、AI 失敗時は旧値のまま残るか 'Summary not available.' のリテラルが入る。title はほぼ常に存在する。content は CONTENT_STORAGE_ENABLED の既定 OFF により大半のユーザーで null のため v1 の対象外とする。
- 再利用する既存共起パイプライン: `src/dashboard/tagCooccurrenceHybrid.ts` の computeTagCooccurrenceHybrid と narrowEntriesToTopTagsHybrid、`src/dashboard/tagClusterLayout.ts` の computeLayout と SVG 描画。computeTagCooccurrenceHybrid は Array<{tags?: string|null}> を受け付けるため、抽出キーワードを "#kw" 形式の疑似タグ文字列に変換するアダプタ（keywordsToTagRows 相当）でそのまま流用する。
- 上限値: `src/utils/computeLimits.ts` の MAX_TAGS_PER_RECORD=50 を 1 レコードあたりのキーワード数 cap に準用し DoS ガードとする。MAX_TAG_CLUSTER_TAGS=50 をクラスタ対象キーワード数の上限に準用する。
- Intl.Segmenter 採用理由: Chrome 標準搭載で辞書依存がなく、日本語を含む多言語の語分割を軽量に実現できる。形態素解析器は辞書サイズが大きく MV3 の CSP とバンドル重量の観点で v1 には重いため不採用とする。
- TextRank との関係: `src/wasm/textrank/` の WASM クレートはキーセンテンス抽出でありキーワード抽出ではないため、任意の前段フィルタとしてのみ位置づけ、v1 の必須経路には含めない。
- FTS5 との関係: FTS5（trigram トークナイザ）は全文検索用であり、キーワード抽出と集計はできないため、抽出と集計はクライアント側 JS と WASM のみで行う。
- 除外ルール: summary が null の行と summary が 'Summary not available.' と完全一致する行はキーワード抽出の入力から除外し、除外件数を集計して画面表示する。title は除外対象にせず、summary 除外行でも title のみで抽出を試みる。
- 期間フィルタ依存: `src/dashboard/components/periodFilter.ts`（PBI 2026-09-24-02 で新設）を再利用する。queryLogs() の {since, until, limit cap 10000} に接続し、期間絞り込みは SQL 側で行う。本 PBI の実装開始には同部品の存在が前提となる。
- ESM と MV3 の制約: TypeScript strict を維持し、import には .js サフィックスを付ける。eval と new Function とインライン script は禁止し、Service Worker 側に状態を保持しない。
- i18n キー一覧（EN と JA の両ファイル `public/_locales/en/messages.json` と `public/_locales/ja/messages.json` に追加し、表示側は data-i18n 属性で参照する）:
  - wordClusterTitle / wordClusterDescription
  - wordClusterEmpty / wordClusterEmptyNoKeywords
  - wordClusterExcludedCount
  - wordClusterPeriodLabel / wordClusterTruncatedNotice
  - wordClusterLoading / wordClusterError
- a11y 要件: WCAG 2.1 AA に準拠する。SVG グラフに role="img" と aria-label を付与し、テキストによる代替サマリ（上位キーワード一覧と除外件数）を提供する。pan と zoom はキーボード操作可能にし、コントラスト比 4.5:1 を満たす。フォーカス順序と可視フォーカスを維持する。

## 見積もり
3 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 autonomous-task-closer）
- 実装: `src/dashboard/keywordExtractor.ts`（Intl.Segmenter 固定 'ja' ロケールで決定性担保・ストップワード ~180 語 EN+JA・最小長 2 コードポイント・最大長 30・50 件 cap・出力を `^[\p{L}\p{N}]+$` に制限しタグパーサ破壊を構造的に防止）、`src/dashboard/wordClusterAdapter.ts`（summary+title → `#kw` 疑似タグ行・除外件数集計）、`src/dashboard/panels/asyncData/wordClusterPanel.ts`（既存 force layout/pan/zoom パイプライン再利用・明示適用・ロード世代ガード・role="img" aria-label テキスト代替）、配線（catalog/factories/index.html/locales/panelCatalog pinned 23→24）
- 統合側修正: BDD「上限 10000 行での期間フィルタ」の打ち切り画面表示が未実装だったため、`queryLogs` の total と突き合わせた行 cap 通知（`wordClusterRowCapNotice`）を統合側で追加（統合検証前に検出・修正・テスト 2 件追加で固定）
- STEP 0: 合成 JA/EN コーパス（11 レコード・失敗行含む）の自動 sanity プローブ実装済み（`wordClusterProbeFixture.test.ts`）。実データでの手動プローブとストップワード/閾値チューニングはユーザー検証として残置（受け入れ基準 1 項目のみ未達）
- 検証: type-check PASS / 対象 69 tests green / lint 0 errors / 全体 13,747 tests green / build PASS
- 備考: GitHub PR レビューはユーザー作業として残置。content 列は参照も取得もせず v1 対象外
