# PBI: dashboardSqliteService テストを confirm-token ハンドシェイクに対応させる

## ユーザーストーリー
CIエンジニアとして、dashboard 系 56 テストが fail-closed 変更後も green になるほしい、なぜなら PBI 03-v1 で破壊的操作が `create_confirm_token` → 操作本体の2段階送信になったが、テストが sendMessage を単発モックしているため token 取得が必ず失敗し `Dashboard confirm token unavailable` で落ちているから

## 優先度
- 順位: 1 / 1
- RICEスコア: 8.0（Reach=1 / Impact=2 / Confidence=100% / Effort=0.25）
- 根拠: CI 全体が赤。fail-closed（本命のセキュリティ修正）の正しさをテストが検証できていない状態

## BDD受け入れシナリオ
Scenario: 破壊的操作は2段階ハンドシェイクを経る
  Given sendMessage モックが1回目の create_confirm_token に { success:true, confirmToken:'tok-1' } を返す
  When  migrateLogs() を呼ぶ
  Then  2回目の sendMessage に confirmToken:'tok-1' が付与されて送信され、スクリプト済みレスポンスが返る

Scenario: token 取得失敗は fail-closed を検証する
  Given sendMessage モックが常に { success:true } (confirmToken 無し) を返す
  When  clearAllLogs() を呼ぶ
  Then  { error: 'Dashboard confirm token unavailable' } が返り IPC は1回のみ（create_confirm_token 自身）

## 受け入れ基準
- [x] shared ヘルパ `givenHandshakeResponse/givenHandshakeError` を `__tests__/helpers/dashboardSqliteMock.ts` に新設し、4ファイルを移行
- [x] dashboardSqliteService 26 + extra 57 + pbi18 21 + readPath 9 + lockContract 6 = 119 tests green
- [x] dashboard 系失敗 0 件（+ lockContract shim 取りこぼしも修正）

## テスト戦略
- 単体: 既存 56 テストのモック置換
- 検証: make test 全体 run

## 見積もり
1pt

## Definition of Done
- [x] 全 BDD シナリオがパスする
- [x] type-check / lint green
