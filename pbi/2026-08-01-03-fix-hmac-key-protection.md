# PBI: HMAC 署名鍵を暗号化して保存する

## ユーザーストーリー
ユーザーとして、拡張機能のストレージにアクセスできる攻撃者に、プライバシー同意や設定インポートのHMAC署名を偽造されないようにしたい。

## ビジネス価値
- 設定インポートの完全性を担保する
- プライバシー同意記録の改ざんを防ぐ
- 通知 URL 署名の偽造を防ぐ

## BDD受け入れシナリオ

```gherkin
Scenario: HMAC 鍵が平文で保存されていない
  Given 拡張機能が初回起動した
  When getConsentHmacKey() が呼ばれる
  Then chrome.storage.local の該当キーは暗号化または保護された形式で保存される

Scenario: 署名偽造が不可能である
  Given 攻撃者が chrome.storage.local を読める
  When 設定インポートの署名を偽造しようとする
  Then importSettings は署名を拒否する
```

## 受け入れ基準
- [ ] 同意用・通知用・設定エクスポート用の各 HMAC 鍵が平文 base64 で保存されていない
- [ ] 既存の平文鍵からの移行パスがある
- [ ] マスターパスワード未設定時も、少なくとも `chrome.storage.session` や `SubtleCrypto` ラップなどで保護される
- [ ] `constantTimeCompare` が署名検証に使われる（可能な箇所）

## テスト戦略（t_wadaスタイル）

### 統合テスト
- 設定インポートの署名検証が、storage を読んだ攻撃者からは偽造できないこと

### 単体テスト
- `getConsentHmacKey`/`getNotificationHmacKey` 保存形式のテスト
- 平文旧データからの移行テスト
- 署名偽造テスト

## 実装アプローチ
- **Outside-In**: `importSettings` の署名検証から始め、鍵保護を強化
- **Red-Green-Refactor**: 偽造テストを先に Red で書く

## 見積もり
3pt

## 技術的考慮事項
- `chrome.storage.session` はブラウザ終了で消えるため、永続化が必要な鍵には別の保護が必要
- マスターパスワード未設定時の鍵導出については ADR 更新を検討

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "getConsentHmacKey\|getNotificationHmacKey\|getOrCreateHmacSecret" src/ -r
```

### 実装手順
1. 各 HMAC 鍵の生成・保存を暗号化ラップ
2. マイグレーション: 起動時に平文鍵を検出して暗号化し直す
3. `settingsExportImport.ts` の署名検証を `constantTimeCompare` に変更

### 落とし穴
- 鍵を暗号化するための鍵（KEK）の管理が新たな問題になる
- マスターパスワード未設定時の保護は限定的

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/utils/crypto/index.ts`, `src/utils/settingsExportImport.ts`, `src/utils/storage/encryptionSession.ts`, `src/utils/storage/types.ts`
- **関連する過去PBI**:
  - `2026-07-25-17-fix-privacy-consent-integrity-signature`（プライバシー同意の HMAC 署名追加）
- **補足**: `encryptionSession.ts` 内の `ENCRYPTION_SECRET` も平文保存されている移行中の秘密情報であり、本PBIの影響範囲に含めて検討する。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
