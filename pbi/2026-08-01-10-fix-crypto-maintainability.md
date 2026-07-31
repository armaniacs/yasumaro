# PBI: 暗号化モジュールの保守性と堅牢性を向上する

## ユーザーストーリー
開発者として、暗号化モジュールが将来の変更で壊れにくく、型で捏造された API や TDZ、未検証のバージョン、暗黙の形式契約などの罠がなくなるようにしたい。

## ビジネス価値
- 将来のセキュリティ強化を安全に導入
- 暗号化形式のマイグレーションを整理
- テスト未カバー分岐の削減

## BDD受け入れシナリオ

```gherkin
Scenario: 存在しない API を型で捏造しない
  Given SubtleCrypto.timingSafeEqual は存在しない
  When types.ts を確認する
  Then その型宣言がない

Scenario: 定数が使用より前に宣言される
  Given ENVELOPE_ITERATIONS を参照する関数がある
  When ファイルを先頭から読む
  Then 定数が関数より前に宣言されている

Scenario: 正当な平文 API キーもマイグレーション対象
  Given レガシー平文 API キーが storage にある
  When getSettings が呼ばれる
  Then 暗号化形式に移行されるか、警告が出る
```

## 受け入れ基準
- [ ] `SubtleCrypto.timingSafeEqual` の型捏造を削除
- [ ] `ENVELOPE_ITERATIONS` などの定数をファイル先頭へ移動
- [ ] `needsRehash` が実際の iteration 数と `ENVELOPE_ITERATIONS` を比較する
- [ ] `hashUrl` の衝突リスクを軽減（長さを伸ばす、または用途を限定）
- [ ] `isEncrypted` が `{ciphertext:'', iv:''}` のような空オブジェクトを false にする
- [ ] 平文 API キーの検出・移行または警告

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 定数 TDZ テスト
- `needsRehash` 各パターン
- `isEncrypted` 空オブジェクトケース
- `hashUrl` 衝突確率テスト

## 実装アプローチ
- **Red-Green-Refactor**: 各保守性問題のテストを追加して修正

## 見積もり
2pt

## 技術的考慮事項
- `hashUrl` の出力形式変更は既存ログに影響
- 平文 API キーの自動暗号化は UX に影響

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "timingSafeEqual\|ENVELOPE_ITERATIONS\|needsRehash\|hashUrl\|isEncrypted" src/utils/crypto/index.ts
```

### 実装手順
1. 型捏造削除
2. 定数順序整理
3. `needsRehash` 修正
4. `isEncrypted` 厳密化
5. 平文 API キー警告/移行

### 落とし穴
- `hashUrl` の形式変更は既存ログに影響
- 平文移行はマスターパスワード有無で挙動が変わる

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/utils/crypto/index.ts`, `src/utils/crypto/types.ts`, `src/utils/storage/settingsStore.ts`, `src/utils/storage/encryptionSession.ts`
- **関連する過去PBI**:
  - `2026-07-25-30-fix-pbkdf2-legacy-timing-sidechannel`
  - `2026-07-25-31-fix-verify-legacy-crypto-export-removal`
- **補足**: `SubtleCrypto.timingSafeEqual` は Web Crypto 標準に存在しない。型宣言削除後、`constantTimeCompare` のフォールバックが唯一のパスとなる。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
