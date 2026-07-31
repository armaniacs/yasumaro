# PBI: 暗号化エンベロープの入力検証を強化する

## ユーザーストーリー
ユーザーとして、細工されたバックアップファイルがインポートされた際に、無限に近いPBKDF2反復や弱いハッシュ関数でUIやService Workerがフリーズ・ダウングレードされないようにしたい。

## ビジネス価値
- DoS 攻撃経路を塞ぐ
- KDF ダウングレードを防ぐ
- 将来のエンベロープ形式変更に備えた拡張性を確保する

## BDD受け入れシナリオ

```gherkin
Scenario: 過大な iterations を拒否する
  Given 攻撃者が作成したエンベロープで iterations が 1000万を超えている
  When importEncryptedBackup で復号を試みる
  Then 即座に検証エラーが返り、PBKDF2 は実行されない

Scenario: 許可されていない hash を拒否する
  Given エンベロープの hash が "SHA-1" になっている
  When decryptEnvelope を呼ぶ
  Then 検証エラーが返る

Scenario: 未来の version を拒否する
  Given エンベロープの version が CURRENT_ENVELOPE_VERSION より大きい
  When decryptEnvelope を呼ぶ
  Then 「未対応のエンベロープ形式」エラーが返る
```

## 受け入れ基準
- [ ] `isEncryptionEnvelope` または `decryptEnvelope` 入口で `iterations` に上限・下限がある
- [ ] `hash` が許可リスト（例: "SHA-256"）のみ受け入れられる
- [ ] `envelope.version` が `CURRENT_ENVELOPE_VERSION` と一致することを `decryptEnvelope` 前に検証
- [ ] `salt`/`iv`/`data` の base64 長さに上限がある
- [ ] 既存の正当なエンベロープは復号できる

## テスト戦略（t_wadaスタイル）

### 統合テスト
- `encryptedBackupService.importEncryptedBackup` が異常なエンベロープを拒否すること

### 単体テスト
- `decryptEnvelope` の境界値テスト（iterations 最大値、最大値+1、0、負数）
- `hash` ホワイトリストテスト
- `version` 不一致テスト
- 巨大 base64 長さテスト

## 実装アプローチ
- **Outside-In**: `importEncryptedBackup` から `decryptEnvelope` までの検証を追加
- **Red-Green-Refactor**: 異常ケースのテストを先に書き、検証ロジックを追加

## 見積もり
2pt

## 技術的考慮事項
- WebCrypto の PBKDF2 は iterations 上限を自前で定義する必要がある
- 上限値は `ENVELOPE_ITERATIONS` の数倍程度が妥当
- エラーメッセージは i18n 対応

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "decryptEnvelope\|isEncryptionEnvelope" src/utils/crypto/index.ts
```

### 実装手順
1. `isEncryptionEnvelope` に `iterations` 範囲、`hash` 許可リストを追加
2. `decryptEnvelope` 内で `version` を `CURRENT_ENVELOPE_VERSION` と比較
3. `base64ToBytes` 前に文字列長の上限を追加

### 落とし穴
- 上限が厳しすぎると将来の正当な値も拒否する
- 下限 0 や負数も拒否すること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
