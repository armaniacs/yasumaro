# PBI: 適応記録 ― 固定しきい値からメディア別判定へ

## ユーザーストーリー
調べ物をする人として、動画・PDF・コード熟読も正しく記録してほしい、なぜなら5秒+50%一律では読んだのに残らない・読んでないのに残るがあるから

## 優先度
- 順位: 02 / 5候補
- RICEスコア: 576 (Reach=900 / Impact=2 / Confidence=0.8 / Effort=2.5人週)
- 根拠: 記録の入口。誤判定の是正は全利用者に効く。Hより先に置くが独立着手可
- 依存: なし。Hとは独立(計測と要約は別経路)

## 背景・制約
- 現行既定は5秒+50%(`src/utils/visitThresholds.ts`)。`visit_duration` は新規行でNULLが常態という自認がある
- メディア別に判定を分ける: 動画は再生時間、PDFはページ深度、コードはコピー+滞在。バックグラウンドタブは除外する
- Content ScriptのCSP・動的import制約(`web_accessible_resources` 同梱)を守る
- 熟読度スコアを保存し、NULL解消を本PBIの出口にする。週次マトリクス等の可視化は含めない

## BDD受け入れシナリオ
Scenario: 動画視聴が記録される
  Given 動画を再生時間のしきい値まで視聴した
  When 自動記録が発火した
  Then 記録が残り、熟読度スコアがNULLではない

Scenario: バックグラウンドは記録されない
  Given 非表示タブでページを開いたままにした
  When 判定条件を満たす時間が経過した
  Then 自動記録は発火せず、手動記録は従来通りできる

## 受け入れ基準
- [ ] メディア別(記事/動画/PDF/コード)の判定条件が設定できる
- [ ] `visit_duration` のNULL常態が解消される(自動記録のvalid-visitに行が入る)
- [ ] バックグラウンド・プレビュー等の誤発火が減る
- [ ] 既存のドメインフィルタ・プライベート判定と干渉しない

## テスト戦略
- E2E: 動画再生→記録→履歴表示、バックグラウンド非発火の通し
- 統合: メディア種別判定の縮退(不明種別は従来条件)のテスト
- 単体: しきい値・境界・NaN入力のテーブルテスト

## 見積もり
2.5人週相当。チームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(判定条件の説明・診断表示を含む)

## 実装記録（2026-10-23・土台と配線完了・残はしきい値UIと記録Payload）
- メディア種別判定: `src/content/mediaKind.ts` でページを記事・動画・PDF・コードに分類。不明種別・破損DOMは従来条件(記事ペア)に縮退し、検出器の盲点が今日の挙動の出口にしかならない（commit 0925238e）
- メディア別しきい値: `visitThresholds.ts` にメディア別既定値（記事5s+50%・動画30s視聴・PDF 15s+2ページ・コード15s+1コピー）。記事ペアは既定値とバイト同一（commit 0925238e）
- VisitGate拡張: 任意メトリック（pdfPagesRead・codeCopies・watchedSeconds）をしきい値が要求するときだけゲート。NaN・未産出の入力は未達として読む（commit 0925238e）
- 配線: VisitGatingDepsにdetectMediaKindを追加（既定は記事定数）。カーネルはロード時に1回分類する（commit b352b152）
- 検証: `npm run validate` exit 0（1124 files / 16753 tests・test type errors 451/451）
- 残タスク: (1) メディア別しきい値の設定UI（dashboard recording-conditionsパネル）(2) 動画再生→記録のE2E
- しきい値UIの再開点: `StorageKeys.MEDIA_THRESHOLDS: 'media_thresholds'` を `src/utils/storage/types.ts` に追加し、StrictSettings にマップ型エントリ（既存のエントリはリテラル型のため要配慮）→ dashboard recording-conditions パネルに4種のしきい値入力 → `mediaThresholdsFor(kind, overrides)` の第2引数に永続化オーバーライドを渡す配線（`src/content/visitGating.ts` の resolveThresholds が既存の受け口）。`initRecordingConditionsSettings` が既存の数値入力パターン（MIN_VISIT_DURATION 等）の規範
- NULL解消: 完了（commit 9c506dfd）。VALID_VISITペイロードに視聴秒数とスクロール率を乗せ、保存行の `visit_duration`/`scroll_ratio` がNULLでなくなる。手動記録はNULLのまま。force再送でもメトリックが落ちない（pin: `src/__tests__/visitDurationWire.test.ts`）
