# PBI: メッセージバリデータに上限サイズ検証を追加

## ユーザーストーリー
利用者として、巨大ペイロードから記録パイプラインが保護されてほしい、なぜならメモリ圧迫やquota超過による記録停止を防ぎ、安定して履歴を保存したいから

## 優先度
- 順位: 03 / 26
- RICEスコア: 3,600（Reach=1000 / Impact=2 / Confidence=0.9 / Effort=0.5日）
- 根拠: 記録パイプライン全体の停止につながるリスクへの対処であり、到達範囲が広く工数が小さいため上位に位置づく

## BDD受け入れシナリオ
```gherkin
Scenario: 正常サイズのメッセージは受け付ける
  Given 各Validatorが上限値を定めている
  When  上限以内のcontent・title・rowsを持つメッセージを検証する
  Then  検証が成功し後続処理に引き渡される

Scenario: 上限超過のメッセージは拒否して記録する
  Given 各Validatorが上限値を定めている
  When  上限を超えるcontent・title・rowsを持つメッセージを検証する
  Then  ValidationErrorで拒否され、切断ではなくログに記録される
```

## 受け入れ基準
- [ ] ValidVisitのcontentに上限（1MB相当）があり、超過時はValidationErrorで拒否される
- [ ] ManualRecordのtitle（500字）・content（1MB相当）に上限があり、超過時はValidationErrorで拒否される
- [ ] Dashboard向けSQLite要求のimport rows（1000件）・全体サイズ（2MB相当）に上限があり、超過時はValidationErrorで拒否される
- [ ] 上限値は定数として一元管理されている
- [ ] 超過時は切断ではなく拒否＋ログ記録となる

## テスト戦略
- 単体: 境界値テスト（上限ちょうど・上限＋1）で各Validatorの受け付け／拒否を検証する
- 単体: import rows件数・全体サイズの上限超過ケースを検証する
- 単体: 拒否時にValidationErrorとなりログ記録されることを検証する

## 実装アプローチ
各Validatorの対象フィールドに上限を設け、超過をValidationErrorとして拒否する方針。上限値は定数化し、切断ではなく拒否＋ログ記録とする。

## 見積もり
0.5日相当（小規模）

## 実装者向け注記
- 対象は `src/messaging/validators.ts` のValidVisitValidator・ManualRecordValidator・DashboardSqliteValidatorの範囲のみ
- 現状コード確認済み：同ファイル内に `VALIDATOR_LIMITS` として上限定数が存在し、各Validatorで長さ・件数の検証が行われている。着手前に最新コードと差分を確認すること
- 上限値の変更や新規フィールドの追加はスコープ外

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
