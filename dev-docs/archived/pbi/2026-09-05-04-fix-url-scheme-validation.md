# PBI: ManualRecordValidator に URL スキーム検証を追加

## ユーザーストーリー
利用者として、手動記録のURLが安全なスキームのみで保存されてほしい、なぜなら危険なスキームのURLが保存・描画されるとstored XSSにつながる恐れがあるから

## 優先度
- 順位: 04 / 26
- RICEスコア: 3,600（Reach=500 / Impact=2 / Confidence=0.9 / Effort=0.25日）
- 根拠: stored XSSに直結する高リスクを低工数で解消できるため

## BDD受け入れシナリオ
```gherkin
Scenario: http/httpsのURLは記録できる
  Given MANUAL_RECORD形式のメッセージがある
  When  payload.urlにhttpまたはhttpsのURLを指定して送信する
  Then  バリデーションが成功する

Scenario: javascriptスキームのURLは拒否される
  Given MANUAL_RECORD形式のメッセージがある
  When  payload.urlにjavascriptスキームのURLを指定して送信する
  Then  バリデーションエラーになる

Scenario: dataスキームのURLは拒否される
  Given PREVIEW_RECORDまたはSAVE_RECORD形式のメッセージがある
  When  payload.urlにdataスキームのURLを指定して送信する
  Then  バリデーションエラーになり記録・保存されない

Scenario: 不正な形式のURLは拒否される
  Given MANUAL_RECORD形式のメッセージがある
  When  payload.urlにURLとして解析できない文字列を指定して送信する
  Then  バリデーションエラーになる
```

## 受け入れ基準
- [x] MANUAL_RECORD/PREVIEW_RECORD/SAVE_RECORDのpayload.urlにhttp/https以外のスキームを指定するとバリデーションエラーになる
- [x] MANUAL_RECORD/PREVIEW_RECORD/SAVE_RECORDのpayload.urlにURLとして解析できない値を指定するとバリデーションエラーになる
- [x] http/httpsのURLは従来どおりバリデーションを通過する
- [x] 既存の非空チェック・他フィールドの検証挙動に変化がない

## テスト戦略
- 単体: ManualRecordValidatorに対し、http/https許可・javascript:/data:拒否・不正形式拒否・3メッセージ種別での共通動作を検証する

## 実装アプローチ
FetchUrlValidatorと同等のURLスキーム制限をManualRecordValidatorのpayload.url検証に適用する

## 見積もり
0.25日

## 実装者向け注記
- 対象は`src/messaging/validators.ts`のManualRecordValidatorのみ
- 既存レコードのマイグレーションは不要

## 実装メモ
- 2026-09-05 完了（commit `6ecd5a30`、PBI 03 と同一コミット）: `ManualRecordValidator` の payload.url に URL パース + protocol が `http:`/`https:` 以外（javascript:/data:/ftp 等を含む）の場合に ValidationError を投げる検証を追加。テスト: `validators-limits.test.ts` の URL scheme 系（不正形式・ftp 拒否・http/https 許可）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
