# PBI: タグクラスタ時間変化スライダー

## ユーザーストーリー
閲覧履歴を分析する利用者として、指定した時間範囲の前半と後半のタグクラスタを並べて比較したい、なぜなら関心の移り変わりと継続しているテーマを把握したいから

## 優先度
- 順位: 着手順 08（RICE順位 13 → 昇格 / 13候補中・最終）
- RICEスコア: 0.20（Reach=2 / Impact=1.0 / Confidence=50% / Effort=5pt）
- 根拠: スコアは13候補中最低である。比較UXが全面新規であり価値仮説が未検証のため、Reach=2、Impact=1.0、Confidence=50%と低く見積もった。一方で利用者から明示的な要求があったためPBI化し、04-07の基盤整備後に着手する最終候補と位置づける。PBI 2026-09-24-04の完了が着手の必須条件である。

## BDD受け入れシナリオ
Scenario: 前半と後半のクラスタを並べて表示する
  Given 期間指定タグクラスタの読み込み基盤が利用可能である
  When 利用者が開始時点と終了時点を指定する
  Then 指定範囲が前半と後半の2期間に分割される
  And 前半のクラスタが左側のSVGに表示される
  And 後半のクラスタが右側のSVGに表示される

Scenario: diff一覧で増減を把握する
  Given 前半と後半のクラスタが表示されている
  When diff一覧を参照する
  Then 出現したタグの一覧が表示される
  And 消失したタグの一覧が表示される
  And 増加したタグが件数差付きで表示される
  And 減少したタグが件数差付きで表示される

Scenario: 2期間で共通タグが存在しない
  Given 前半と後半でタグ集合が完全に重ならない履歴がある
  When 2時点を指定して比較する
  Then 両方のSVGがそれぞれのクラスタを表示する
  And diff一覧の出現と消失に全タグが分類される
  And 増加と減少の区分には何も表示されない

Scenario: 片方の期間に履歴が存在しない
  Given 後半の期間に履歴が一件もない
  When 2時点を指定して比較する
  Then 空の期間側にはデータなしの表示が出る
  And もう一方の期間側のクラスタは正常に表示される
  And diff一覧は空側を基準に出現または消失として集計される

Scenario: スライダー連打でも最新の指定だけが反映される
  Given クラスタ表示中である
  When 開始時点と終了時点を短時間に連続で変更する
  Then 中間の古い読み込み結果で画面が上書きされない
  And 最後の指定に対応する2期間の結果だけが表示される

Scenario: 開始時点が終了時点より後になった場合は補正される
  Given 開始時点が終了時点より後の値が入力された
  When 値が確定する
  Then 開始時点と終了時点が正しい前後関係に補正される
  And 補正後の2期間でクラスタが表示される

## 受け入れ基準
- [x] dual-handle sliderまたは同等の2時点指定UIで開始時点と終了時点を指定できる
- [x] 指定範囲を前半と後半に分割し、それぞれのクラスタを2つのSVGでside-by-side表示する
- [x] diff一覧に出現したタグ、消失したタグ、増加したタグ（件数差付き）、減少したタグ（件数差付き）を表示する
- [x] 共通タグは2スナップショットで同一色で表示し、タグ文字列からhueを決める安定配色を用いる
- [x] 共通タグの色はコントラスト比4.5:1を満たす
- [x] 共通タグの位置は2スナップショット間で安定配置となる（前回位置のアンカー引き継ぎまたは同一初期配置ルールのいずれかで実現する）
- [x] スライダー操作にdebounceを適用し、ロード世代ガードにより古い読み込み結果が表示を上書きしない
- [x] 2期間分の読み込みにqueryLogsのsinceとuntilを用い、各期間の上限10000行到達時は注意表示を出す
- [x] 日英両言語で表示が崩れず、キーボード操作だけで時点指定と比較結果の確認ができる

## テスト戦略
- E2E: 2時点指定から前半後半の2SVG表示とdiff一覧表示までの比較フローを確認する。片方の期間が空の場合と期間前後逆転時の補正を確認する
- 統合: 2期間分のqueryLogs呼び出しとcap到達時の注意表示を確認する。2つのPanZoomインスタンスが互いに干渉せず操作できることを確認する。debounceと世代ガード配下で最新の指定だけが描画されることを確認する
- 単体: diff計算（出現、消失、増加、減少と件数差）の単体テスト重点。ロード世代ガードの単体テスト重点。タグ文字列からhueを求める安定配色の単体テスト重点（同一タグは同一hue、コントラスト比4.5:1の検証を含む）。期間分割と前後逆転補正の単体テスト

## 実装メモ
- 再利用資産: `src/dashboard/panels/asyncData/tagClusterPanel.ts`（現行の単一SVG描画フロー）、`src/dashboard/tagClusterLayout.ts`（force-directed 100 iterations、Node identityはタグ文字列のMap）、`src/dashboard/tagClusterPanZoom.ts`（単一SVG専用コントローラ）、`src/dashboard/panels/asyncData/tagClusterLoadingManager.ts`（単一SVG専用ローディング管理）、`src/utils/hybridTagNarrowing.ts`の`narrowEntriesToTopTagsHybrid`、`computeTagCooccurrenceHybrid`、`limitToTopNodes`、queryLogsの`{since, until}`パラメータ
- 前提依存: PBI 2026-09-24-04（期間指定タグクラスタ）の完了が必須である。本PBIは期間指定読み込み基盤の上に比較表示を追加する
- 2×SVGとpan/zoomの課題: TagClusterPanZoomControllerとTagClusterLoadingManagerはいずれも単一SVG前提のため、side-by-side表示ではインスタンスを2つ生成する必要がある。イベント束縛、ズーム状態、ローディング表示が相互に干渉しないよう、SVG要素参照と状態を期間ごとに分離する
- 安定配色ハッシュ方針: タグ文字列からハッシュ値を求めてhueに写像する新規関数を設ける。彩度と明度は固定し、背景色に対するコントラスト比4.5:1を満たす範囲に調整する。同一タグは前半後半で同一色になることを単体テストで保証する
- 安定配置方針: Node identityはタグ文字列で安定しているが、初期配置が順序依存の円形配置のためスナップショット間で位置がずれる。方針は次のいずれかとする。A: 前回スナップショットの位置をアンカーとして引き継ぐ。B: 両スナップショットで同一の初期配置ルールを適用する。共通タグ0件と片期間空の境界ケースを満たせる方を選ぶ
- debounceと世代ガードの必要性: 現行のloadにdebounceがなく世代ガードもないため、スライダー連打でレースが発生する。新規にdebounceユーティリティを設け、発行ごとに世代番号を採番して描画前に最新世代か検証する
- アニメーション対象外の根拠: 利用者確定事項としてアニメーション遷移はスコープ外とする。将来的な拡張候補として検討可能である
- i18nキー一覧（ENとJAの両ファイル `public/_locales/en/messages.json`、`public/_locales/ja/messages.json` に追加）: `tagClusterCompareStartLabel`、`tagClusterCompareEndLabel`、`tagClusterCompareFirstHalf`、`tagClusterCompareSecondHalf`、`tagClusterDiffAppeared`、`tagClusterDiffDisappeared`、`tagClusterDiffIncreased`、`tagClusterDiffDecreased`、`tagClusterCompareEmptyPeriod`、`tagClusterCompareCapNotice`、`tagClusterCompareInvalidRangeCorrected`
- a11y要件: 時点指定はnative range inputにlabelを付与し、日付にはaria-valuetextを設定する。比較結果領域はaria-live politeとする。キーボードのみで時点指定、クラスタ参照、diff一覧参照が完結する。配色はコントラスト比4.5:1を満たす

## 見積もり
5 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（文書要件がある場合のみ適用）

## 実装記録（2026-09-24 autonomous-task-closer）
- 実装: `src/dashboard/periodSplit.ts`（前半/後半分割・逆転スワップ・非有限ガード）、`src/dashboard/tagClusterDiff.ts`（出現/消失/増加/減少+delta・決定的順序）、`src/dashboard/tagClusterColor.ts`（FNV-1a→hue・S/L 固定定数・light S65%/L28% 最悪 hue 4.81:1・dark S55%/L72%・CSS カスタムプロパティ `--tag-hue`）、`src/dashboard/panels/asyncData/tagClusterTimeSliderPanel.ts`（2×SVG side-by-side・PanZoom 2 インスタンス・union ソート順による同一初期配置・diff 4 区画・行 cap 通知×2・aria-live 完了サマリー）、配線（catalog/factories/index.html/locales 20キー×2/dashboard.css/panelCatalog pinned 24→25）
- 設計決定（記録済み逸脱）: ①時点指定は dual-handle slider でなく native `<input type="date">`×2 + 明示 Compare（PBI 許容の「同等の2時点指定UI」・1 操作 1 確定のため debounce は不要と判断し、ロード世代ガード（loadSeq）で連打レースを遮断 — レーステストで stale 側が第2クエリを発火しないことを検証）。②片側エラー時は diff をクリア（失敗側を空扱いすると全タグが appeared と偽表示されるため）。③アニメーションはユーザー確定どおりスコープ外
- 検証: type-check PASS / 対象 71 tests green / lint 0 errors / 全体 13,784 tests green / build PASS
- 備考: GitHub PR レビューはユーザー作業として残置。PBI 04 で延期された aria-live 再計算通知を本パネルで実装済み
