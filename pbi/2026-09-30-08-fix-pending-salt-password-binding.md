# PBI: KEK 回転アンカーをパスワードに紐付けて別パスワード再試行時の詰まりを防ぐ

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードを変更中に中断されたユーザーとして、再試行時に別のパスワードを入力しても「なぜ失敗し続けるのか」が分かる状態を目指す。なぜなら、アンカーには salt しか保存されておらず、中断後に異なるパスワードで再試行すると部分的に移行済みの ciphertext がどちらの KEK でも読めず、明示的な案内のないまま恒久的に abort を繰り返すから。

## 優先度

- 順位: 8 / 13
- RICE スコア: 4.0(Reach=2 / Impact=1 / Confidence=1.0 / Effort=0.5)
- 根拠: 回復経路(同じ失敗パスワードの再入力)は実在するためデータ喪失ではないが、ユーザーにそれが伝わらず詰まって見える。docs 不整合の解消も含む。

## 証拠(レビュー由来・反証済み)

- `src/utils/storage/encryptionSession.ts:463-468` — アンカーには salt 文字列のみを保存(パスワード・hash との束縛なし)
- `:465` / `:478` — 再試行時も anchoredSalt を再利用し、`next` は入力パスワード依存で導出される
- `apiKeyTransition.ts:100-110` — 旧 KEK でも新 KEK でも復号不能な field は `unrecoverable`
- `encryptionSession.ts:393-395` — `ReencryptionAbortedError` で恒久 abort(異なるパスワードでの再試行時)
- `:490-495` — finally は `MASTER_PASSWORD_SALT === saltBase64` のときだけアンカーを削除。metadata 未書き込みの abort ではアンカーが残り続ける(回復経路は閉じない — これ自体は resume 機構として正しい)
- `src/utils/storage/types.ts:105` — 「中止時に削除」と記載があるが abort 時削除の実装は存在しない(コードとドキュメントが矛盾)
- 回復性: 同じ失敗パスワードの再入力なら `alreadyMigrated` 経由で収束する(`encryptionSession-reencrypt.test.ts:284-330` が回帰として固定)

## BDD 受け入れシナリオ

```gherkin
  Scenario: 中断後に異なるパスワードで再試行すると明示的に案内される
    Given KEK 回転が中断され PENDING_SALT アンカーが残っている
    When 元の回転と異なるパスワードで再試行する
    Then 専用エラーで中断中の回転が存在することが示される
    And ciphertext と metadata は一切変更されない
    And エラー文言は回復手順(元のパスワードでの再試行)を示す

  Scenario: 同じパスワードでの再試行は resume して完了する
    Given 同じ中断状態である
    When 元の回転と同じパスワードで再試行する
    Then 既存の resume 挙動のとおり収束する
```

## 受け入れ基準

- [ ] アンカーレコードに回転開始時の新パスワード検証子(hash)を追加し、再試行時に一致検証する
- [ ] 不一致時は専用エラー(既存の `ReencryptionAbortedError` と区別可能)を投げ、回復手順をメッセージに含める
- [ ] ciphertext・metadata・アンカーは不一致時に一切変更されない
- [ ] `types.ts:105` のコメントを実際の挙動(成功時に昇格、abort 時は resume 用に保持)へ修正する。または abort 時削除を実装する場合は resume テストとの整合を先に確認する
- [ ] `dashboard/masterPassword.ts` のエラー表示(`abortMessage`)が新エラーを適切に扱う
- [ ] i18n 2 言語でメッセージを追加する

## テスト戦略

### 統合
- 中断 → 異なるパスワード再試行(専用エラー・不変性確認)→ 同じパスワード再試行(収束)の一連を検証する

### 単体
- anchor 一致検証の分岐(一致 / 不一致 / アンカー不在)を検証する

## 実装アプローチ

1. アンカーを `MASTER_PASSWORD_PENDING_SALT` と並ぶ新キー(例: `MASTER_PASSWORD_PENDING_HASH`)に拡張する。既存 resume テスト(`encryptionSession-reencrypt.test.ts:311` が salt を手植え)との互換性を先に確認する
2. `rotateToNewMasterPassword` 冒頭でアンカー存在時に入力パスワードの hash と pending_hash を比較する
3. docs 修正は types.ts のコメントを実際の挙動に合わせる方向で行う(abort 時削除は resume 機構と矛盾するため)

## 制約

- 既存の resume 収束テストを壊さない
- pending_hash からパスワードが復元できないこと(hash であり PBKDF2 で保護済み)
- async/await のみ。ESM import は `.js` 拡張子

## 見積もり

2 SP

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] i18n 更新済み(en/ja)
- [ ] コードレビュー完了
