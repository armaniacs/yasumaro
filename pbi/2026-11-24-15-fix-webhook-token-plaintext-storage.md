# PBI: webhook 宛先 URL の平文保存を暗号化し content script から読めないようにする

## ユーザーストーリー
webhook を使う利用者として、設定した宛先 URL(クエリやパスに秘密が入り得る)が暗号化され、必要な場面以外から読めないようになっていてほしい、なぜなら現状は平文で `chrome.storage.local` にあり、content script からも読める既定のままからである。

## 優先度
- 順位: 06/12 の監査 run-3 の confirmed C-1 に対応
- RICE: 要チームでの見積もり
- 根拠と依存: なし。後続は 2026-11-24-08(実機スモーク)

## ビジネス価値
- token 付き URL の漏えい面が狭まる
- 測定方法: 保存後の storage に平文 URL が残らず、既存の保存・送信・再送のテストが緑のままであること

## BDD受け入れシナリオ

```gherkin
Scenario: 保存した宛先 URL は storage に平文で残らない
  Given 利用者が token 付きの https URL を保存する
  When `chrome.storage.local` の `webhook_export_settings_v1` を読む
  Then 平文の URL は含まれず、暗号文か読めない形になっている
  And   保存の状態表示と送信は従来どおり動く

Scenario: content script から宛先 URL を読めない
  Given 宛先が保存されている
  When content script の権限で storage を読む
  Then 宛先 URL の平文を得られない
  And   記録パイプラインの送信は従来どおり動く
```

## 受け入れ基準
- [ ] 宛先 URL が API キーと同等の保護(API キーと同様の暗号化、または `setAccessLevel` による到達制限)で保存される
- [ ] 既存の保存済み設定は移行され、無効化されない(祖父条項と同様の配慮)
- [ ] 状態表示・履歴・通知・ログに URL 全文が出ない性質が保たれる
- [ ] dirty な storage からの復元(normalize の fail-closed)が保たれる

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加しない(08 の実機スモークで保存と送信の導通を確認)

### 統合テスト
- 保存→storage→送信の往復で、storage に平文が無いことと送信が成功すること

### 単体テスト
- 暗号化前は storage ダンプに平文が出る発火デモ(修正前に赤、修正後に緑)
- 平文 token の `not.toContain` 系の既存 pin が緑のまま

## 実装アプローチ
- **Outside-In**: 統合テストの発火デモから書き、赤を確認してから実装
- **Red-Green-Refactor**: TDD サイクルで進める
- 修正中に監査対象のコードを変えない(run-3 の成果物は固定済み。本 PBI は別差分として扱う)

## 見積もり
3 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 暗号化の seam は API キーの前例(`encryptApiKey`)に従う
- 非機能要件: 復号の失敗は fail-closed(送信しない)にする
- ロールバック手段: 暗号化を無効化すれば現行方式に戻せる。移行済み設定の読み戻しに注意

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること。

```bash
git -C /Users/yaar/Playground/yasumaro grep -n "WEBHOOK_EXPORT_SETTINGS_KEY\|setAccessLevel" src/background/webhookExport/webhookExportSettings.ts
git -C /Users/yaar/Playground/yasumaro grep -rn "setAccessLevel" src/ --include="*.ts" | grep -v __tests__
```

確認結果(run-3 時点):
- 保存は `JSON.stringify(normalized)` を `store.set` するだけ
- 生産コードに `setAccessLevel` の呼び出しは無い

### 実装手順
1. 発火デモ(平文ダンプ)を先に書く
2. API キーと同様の暗号化か到達制限を入れる
3. 既存設定の移行を入れる
4. `npm run validate` で全体を確認

### 落とし穴
- 再送(`defaultResend`)と記録パイプラインの両方で復号経路を通すこと
- ログ・通知・履歴に平文を出さないこと(既存 pin が守る)

## Definition of DoD
- [ ] 全 BDD シナリオがテストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了(秘密情報の扱いの確認を PR 説明に明記)
- [ ] ドキュメント更新済み(脅威モデルの残余リスク節の更新を含む)
- [ ] CHANGELOG の `[Unreleased]` に利用者向けの変更として記載

## 引き継ぎ
状態: 未着手。run-3 の C-1 に対応する修正 PBI。
