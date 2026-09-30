# PBI: 匿名 KEK の再生成を fail-closed にして既存 API キーの孤立を防ぐ

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

暗号化済み API キーを保存しているユーザーとして、ストレージの部分復元や破損で ENCRYPTION_SECRET だけ欠けた状態になっても、保存済み API キーが勝手に無効化されない状態を目指す。なぜなら、secret が欠けたまま新たな salt+secret ペアを生成して既存 salt を上書きされると、既存 ciphertext はどの KEK でも復号できなくなり、全 API キーの再入力を強いられるから。

## 優先度

- 順位: 1 / 13
- RICE スコア: 36.0(Reach=3 / Impact=3 / Confidence=1.0 / Effort=0.25)
- 根拠: 全 API キーの孤立という最悪事象を最小工数で塞げる quick win。機構は反証済みで確定。

## 証拠(レビュー由来)

- `src/utils/storage/encryptionSession.ts:296-298` — `if (!saltBase64 || !secret)` で `generateAndPersistSecret()` が走り、`:177-180` が既存 ENCRYPTION_SALT を含めて上書きする
- 鏡像ケース(secret あり salt なし)は `:285-294` で `CORRUPTION: encryption salt missing` として fail-closed — 非対称は omission
- トリガー条件: salt があり secret が欠けた状態(部分復元・破損)。この状態で API キー ciphertext が残っていれば全件孤立する

## BDD 受け入れシナリオ

```gherkin
  Scenario: salt があり secret が欠けている場合は生成しない
    Given ENCRYPTION_SALT が保存され ENCRYPTION_SECRET が欠けている
    When getOrCreateAnonymousSecretKey が呼ばれる
    Then 明示的な破損エラーで失敗する
    And ENCRYPTION_SALT と ENCRYPTION_SECRET は一切変更されない

  Scenario: 新規インストールは従来どおり生成する
    Given ENCRYPTION_SALT も ENCRYPTION_SECRET も存在しない
    When getOrCreateAnonymousSecretKey が呼ばれる
    Then salt と secret が生成され保存される
```

## 受け入れ基準

- [x] `saltBase64 && !storedSecret` で session 救済も失敗した場合、`generateAndPersistSecret()` を呼ばず fail-closed する
- [x] 鏡像ケース(secret あり salt なし)の既存 CORRUPTION throw(`:285-294`)は維持される
- [x] session storage 救済経路(`:241-265`)の現行動作は変更しない
- [x] 秘密値・salt がエラーメッセージ・ログに現れない

## テスト戦略

### 単体
- salt/secret の有無 4 状態 × session 救済の有無で分岐を検証する
- fail-closed 時に salt が上書きされないことを検証する

### 統合
- 部分欠損状態を構築し、API キー読み出しが破損エラーで停止し ciphertext が保持されることを検証する

## 実装アプローチ

1. `encryptionSession.ts:296` の条件を分割する。`saltBase64 && !secret` は `CORRUPTION: encryption secret missing` 相当で throw、`!saltBase64 && !secret`(真の新規インストール)のみ生成へ進む
2. `apiKeyTransition.ts` 側の pure logic には影響しない

## 制約

- async/await のみ。ESM import は `.js` 拡張子
- 2026-08-12 インシデント型の「勝手な再生成による孤立」を再導入しない

## 見積もり

1 SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
