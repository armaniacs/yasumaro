# PBI 10: encryptionSession 内重複の集約（PBKDF2・4 キー読み取り・secret 生成）

## ユーザーストーリー
メンテナーとして、暗号化セッション内の重複コードが 1 実装に集約された状態がほしい、なぜなら KDF 周りの重複は復号不能（API キー喪失）に直結する領域で、3 箇所の同形コードが片側だけ修正されるリスクを常時抱えるから。

## 変更点の概要
encryptionSession.ts 内の 3 重複（PBKDF2 ボイラープレート・4 キー auth-meta 読み取り・secret 生成）を、crypto/primitives.ts に既にある受け皿または新設の非公開ヘルパーへ集約する。生成される鍵・値は不変。

## 現状と問題
- PBKDF2 ボイラープレート: src/utils/storage/encryptionSession.ts:112-153（deriveKeyFromPassword）が src/utils/crypto/primitives.ts:121-158（deriveKey）と同形。呼び出し元 3 箇所（envelope/settings export/password change）
- 4 キー auth-meta 読み取り ×3: encryptionSession.ts:689-712 / :750-773 / :842-877（verifyMasterPasswordWithRehash・removeMasterPasswordUnlocked など）
- secret 生成 ×2: encryptionSession.ts:196-218 / :908-915（generateAndPersistSecret / generateAndStoreHmacSecret）
- 併せて KEY_LENGTH=256 / IV_LENGTH=12 の二重定義（primitives.ts:18-19 vs hmacKeyStore.ts:71-72）は PBI 04 で統一
- テスト: encryptionSession 系テストは復号往復・rehash・legacy パスを検証

## 変更の理由
[DRY] 鍵導出の重複は「片側だけの塩・反復数修正」が復号不能を生む領域。primitives.ts に受け皿が既にある。

## 提案コード（骨子）
- deriveKeyFromPassword は primitives.deriveKey へ委譲（塩・反復数・KEY_LENGTH は現行値を維持）
- auth-meta 読み取りは readAuthMeta(): Promise<{...}> ヘルパーへ（返すキー集合は現行と同一）
- secret 生成は 1 ヘルパーへ（長さ・フォーマットは現行と同一）

## BDD受け入れシナリオ
Scenario: 鍵導出の等価性
  Given 現行 deriveKeyFromPassword で鍵を導出する
  When 委譲後に同じパスワード・塩・反復数で導出する
  Then 生成される鍵は変更前とバイト同一である

Scenario: auth-meta 読み取りの等価性
  Given storage に 4 キーの auth-meta がある
  When readAuthMeta を通す
  Then 返る値は変更前の 3 箇所と同一である

## 見積もり
2 pt（RICE: 30 = Reach 10 × Impact 3 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [x] 鍵導出・secret 生成の等価性を pin するテスト通過
- [x] encryptionSession 系の既存テスト全通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- 現在地は src/utils/storage/encryptionSession.ts（980 行）。deriveKeyFromPassword を既存共有プリミティブ primitives.deriveKey へ委譲（派生パラメータ同一・鍵バイト同一）、4 キー auth-meta 読み取り ×3 を新規非公開ヘルパー readAuthMeta() に統合、secret 生成 ×2 を generateSecretBase64() に統合
- 意図的な設計判断: validateStoredIterations の呼び出し位置は 3 パスのエラー優先順位が異なるため各呼び出し側に維持（移動すると監視可能な挙動変化が生じるため挙動完全不変を優先。検証実装自体は primitives.assertValidStoredKdfIterations に集約済み）
- pin テスト: src/utils/storage/__tests__/encryptionSession-kdf-delegation-pin.test.ts（新規 4 tests。セッション鍵 ≡ deriveKey(password, salt, ENVELOPE_ITERATIONS) を AES-GCM クロス復号で証明、rotation 再暗号化 ciphertext も pin）
- 検証: scoped 14 ファイル 124 tests + 関連スイート 162 + dashboard masterPassword 系 210 全 green、type-check 通過、validate:fast green
