# PBI messaging層の型境界と検証漏れの是正

## ユーザーストーリー
開発者として、gateway・transport・validatorの型の抜け穴が塞がれてほしい、なぜなら実行時まで漏れた不整合は障害原因の特定を遅らせるから。

## 優先度
順位 12/17。RICE 32 (Reach=80 / Impact=1 / Confidence=80% / Effort=2人日)。根拠: 保守性中心。

## 対象の指摘
検証済み7件。実装詳細は書かない。
1. src/messaging/gatewayFactory.ts:68 ― as unknown as Extract<...>による二重キャストがペイロード不整合をコンパイル時に消す。
2. 同:27-30 ― 20秒/60秒予算がここ固有でsendRetryDefaults.tsと別管理になっている。
3. src/messaging/messageTransport.ts:90-92 ― バージョン付与後にtypeしか検証せずペイロード無検査で送信する。
4. src/messaging/validators.ts:353-356 ― stagingNameGuardのcatchが復号失敗詳細を捨てる。
5. 同:386-391 ― importBytesGuardのJSON.stringifyが循環参照で非ValidationErrorのTypeErrorを投げる。
6. src/messaging/normalizeGatewayResponse.ts:45 ― 最小形状確認後にraw as Rで余分/不正fieldごと素通りする。
7. src/messaging/sqliteOperationSecurity.ts:213-217 ― includeDeleted(boolean)をnumber|undefinedにキャストしてハッシュ化し型と実態がずれる。

## BDD受け入れシナリオ

```gherkin
Scenario: 通常送受信の回帰なし
  Given 従来通りの送信条件が整っている
  When 通常の送受信と検証を行う
  Then 従来通り成功し結果が変わらない

Scenario: ペイロード不整合の検出
  Given 型と実態が合わないペイロードがある
  When 送信または受信の検証を行う
  Then コンパイル時または検証段階で検出される

Scenario: 循環参照入力の層別エラー
  Given 循環参照を含む入力がある
  When 取込検証を行う
  Then 層別の想定内エラーとして扱われる
```

## 受け入れ基準
- [x] 上記7件の指摘に対処している
- [x] 通常の送受信と検証に回帰がない
- [x] ペイロード不整合がコンパイル時または検証で検出される
- [x] 循環参照入力が層別の想定内エラーになる
- [x] 回帰テストが追加され成功する

## テスト戦略
- 単体テスト中心。型の境界と異常入力を重点にする
- 正常系の送受信と検証の回帰を確認する
- ペイロード不整合の検出を確認する
- 循環参照入力の振る舞いを確認する

## 見積もり
M

## Definition of Done
- [x] 全BDDが自動テスト化され成功する
- [x] レビューが完了している
- [x] 型検査が緑である

## 出典
adversarial-code-review 2026-11-08。
