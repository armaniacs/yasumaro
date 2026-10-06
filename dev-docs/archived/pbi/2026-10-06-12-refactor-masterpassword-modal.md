# PBI: MasterPassword のモーダル開閉の対称重複を畳む

## ユーザーストーリー

認証 UI の保守担当者として、モーダル開閉を 2 関数に畳みたい。設定・認証の show/close が各 10 行前後で同文であり、片方だけ修正するとフォーカストラップ漏れ・表示残留が起きるから。

## 優先度

- 順位: 12/23
- RICE: 3.0（R3 / I1 / C1.0 / E1）
- 根拠: 1 ファイル内。外部契約不変
- 依存: なし

## 背景（file:line 現状）

すべて `src/dashboard/masterPassword.ts`:

- `:137-156`（showPasswordModal。`:150-155` が表示遷移 6 ステップ）
- `:260-271`（showPasswordAuthModal。同一 6 ステップ）
- `:158-170`（closePasswordModal。入力クリア付き）
- `:273-282`（closePasswordAuthModal。同一骨格）
- `:174-182`（cancel 対。`close + void loadSettings()`）
- `:416-431`（close/cancel/submit/背景クリックの 6 配線）

## BDD受け入れシナリオ

```gherkin
Scenario: 開閉が共通関数になる
  Given 設定・認証のいずれかのモーダル
  When 開閉する
  Then setModalVisible / hideModal を経由し、遷移・trap・focus が従来と同一である

Scenario: 差分が残る
  Given タイトル・入力クリア等の差分
  When 処理する
  Then 各 show/close に差分だけ残り、`pendingOldPassword` のクリア位置（:168）は不変である
```

## 受け入れ基準

- [x] `setModalVisible(modal, ...)` / `hideModal(modal, ...)` の 2 内部関数に畳まれている
- [x] `focusTrapManager.trap/release`・`offsetHeight` 読み・`display` 操作が共通化側にある
- [x] 差分（タイトル・入力クリア等）だけが各 show/close に残っている
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 masterPassword テストが green
- 実時間待ちは使わない

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/dashboard/masterPassword.ts` のみ（2 内部関数＋差分残し。配線・クリア位置不変）
- ゲート: colocated 7 ファイル 103 tests green / type-check PASS / lint 0 errors
