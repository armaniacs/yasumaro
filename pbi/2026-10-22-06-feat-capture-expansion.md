# PBI: 取り込み拡大 ― PDF・動画書き起こし・SPA追従と失敗可視化

## ユーザーストーリー
文献・動画で調べる人として、PDFと動画とSPA後半も記録の対象にしたい、なぜなら取りこぼしが多いと検索への信頼が落ちるから

## 優先度
- 順位: 06 / 6候補
- RICEスコア: 200 (Reach=600 / Impact=2 / Confidence=0.5 / Effort=3.0人週)
- 根拠: 需要は広いがCSP・権限・ストア審査の壁で確信度が低い。先に失敗理由の可視化だけでも価値を出す
- 依存: なし。段階的に切り出すこと(全部一括はしない)

## 背景・制約
- 対象: PDFビューワ、YouTube字幕、無限スクロールSPAの遅延分から着手。file://・認証裏・ペイウォール・キャンバス描画は対象外と明示する
- Content ScriptのCSP・動的import制約(`web_accessible_resources` 同梱)を守る。分割時はmanifest更新を必須にする
- Firefox実験対応・モバイル縮退(FTS→LIKE)の範囲を超えない

## BDD受け入れシナリオ
Scenario: PDFが記録される
  Given PDFを開いてしきい値まで読んだ
  When 自動記録が発火した
  Then タイトル・URL・抜粋が記録され検索で引ける

Scenario: 記録できない理由が分かる
  Given 記録対象外のページを開いた
  When 記録状態を確認した
  Then 対象外の理由(権限・CSP・種別)が診断表示で分かる

## 受け入れ基準
- [ ] PDF・動画字幕・SPA遅延分のいずれかが段階的に記録できる
- [ ] 対象外ページで理由表示が出る(沈黙の失敗にしない)
- [ ] 既存のクレンジング・PIIマスキングが新経路にも適用される
- [ ] バンドル肥大の計測があり上限を超えない

## テスト戦略
## 実装記録（2026-10-23・失敗可視化の語彙）
- 対象外理由の分類表: 完了。`src/dashboard/captureFailureReasons.ts` の `CAPTURE_FAILURE_REASONS` がツリー実在の理由コード15件を権限・CSP・種別・同意・保存・重複に分類(PRIVATE_PAGE_DETECTED・domain_excluded・csp_blocked・non-html・unsupported-kind・privacy_consent_required・rate_limited・paused・sqlite-client-absent・no-client・no-write・obsidian-disabled・obsidian-write-failed・pipeline-error・same_day)。診断表示が理由を示す語彙(沈黙の失敗にしない)
- 縮退の出口: `classifyCaptureFailure` はunknownコード・非文字列・空文字を internal/unknown に分類(例外なし・欠落なし)。未列挙コードはdriftとしてpinされる
- 対応範囲と対象外一覧: 完了。`CAPTURE_SCOPE` がDoD文書の単一情報源(article=done、PDF・動画字幕・SPA遅延分=planned、file://・認証裏・ペイウォール・キャンバス描画=excluded)。PBI明示の対象外をそのまま載せる
- 正直な範囲: 本スライスは語彙のみ。PDF・動画字幕・SPA遅延分の記録経路と診断パネルへの最終結果表示の配線は後続スライス(本テーブルを消費する)。Content ScriptのCSP・web_accessible_resources制約は触らない。クレンジング・PIIマスキングは既存経路のまま
- pin: `src/dashboard/__tests__/captureFailureReasons.test.ts` 6テスト(分類テーブル・fail-closed・重複なし・範囲一覧)
- 残: 診断パネルへの最終結果表示の配線、PDF・動画字幕・SPA遅延分の段階的記録、字幕取得失敗・遅延未到達の縮退テスト、バンドル肥大の計測と上限、E2E通し、コードレビュー、ドキュメント更新(対応範囲と対象外一覧)
- E2E: PDF記録→検索、対象外理由表示の通し
- 統合: 字幕取得失敗・遅延ロード未到達の縮退テスト
- 単体: 種別判定・抜粋切り詰め・権限分岐のテーブルテスト

## 見積もり
3.0人週相当。壁の調査結果で分割するためチームで再見積もりすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み(対応範囲と対象外一覧を含む)
