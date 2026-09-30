# PBI: 本番到達不能な並行マスターパスワード実装を削除して canonical 実装に集約する

種別: refactor
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワード機能を保守する開発者として、同名の set/change 実装が 2 系統に分かれた状態を解消したい。なぜなら、本番到達不能な旧実装(`utils/masterPassword.ts`)は 4 件のハードコード field リストや非アトミックな書き込みを抱えており、誤って wiring したり grep でこちらを修正したりすると `provider_api_key` / `github_pat` が旧 KEK に取り残されるから。

## 優先度

- 順位: 11 / 13
- RICE スコア: 2.0(Reach=1 / Impact=0.5 / Confidence=1.0 / Effort=0.25)
- 根拠: 直接のユーザー影響はないが、誤修正・誤 wiring のリスクを実在のコードとして除去する。

## 証拠(レビュー由来・全 import 走査で確認済み)

- 本番 import は 3 箇所のみ: `dashboard/masterPassword.ts:12-16`(verify/isSet/strength)、`utils/masterPasswordUiCore.ts:7`(validator 2 件)、`utils/storage/encryptionSession.ts:10`(strength)。`setMasterPassword` / `changeMasterPassword` を import する本番コードはゼロ(テストのみ: `utils/__tests__/masterPassword.test.ts:15,17`)
- dashboard は encryptionSession 版を alias で使用(`dashboard/masterPassword.ts:17-22` → `:212`/`:218`)
- `utils/masterPassword.ts:105` `setMasterPassword` — metadata を直接書くだけで既存 ciphertext を再暗号化しない
- `:183` `changeMasterPassword` — `:235` の per-field 書き込みが `:239-241` の metadata 書き込みに先行する非アトミック、catch(`:244`)で途中失敗すると一部だけ新 KEK の不整合が残る
- `:220` — `['obsidian_api_key', 'gemini_api_key', 'openai_api_key', 'openai_2_api_key']` の 4 件ハードコードで canonical 6 件(`storage/apiKeyFields.ts:15-22`、`provider_api_key` / `github_pat` 欠落)と不一致。nested `settings` blob も未対応
- `:188` — `_reencryptFn` は JSDoc(`:180`)に反して一度も呼ばれない
- `:208` — salt 欠損時にランダム salt で oldKey を導出し全再暗号化を壊す
- `:163-166` — rehash が `MASTER_PASSWORD_KDF_ITERATIONS` を更新せず、encryptionSession 版(`:630-634`)と乖離
- 本実装の由来: commit 988b6157 で dashboard の import が encryptionSession 版へ切り替わり死蔵化

## BDD 受け入れシナリオ

```gherkin
  Scenario: マスターパスワード操作の実装系統が単一になる
    Given リポジトリに set/change の実装が存在する
    When production コードの import を走査する
    Then encryptionSession 版のみが参照され、utils 版の set/change は存在しない

  Scenario: 削除後も既存の全テストが green である
    Given 死蔵実装とそのテストが削除されている
    When validate(type-check + test)を実行する
    Then 全テストがパスする
```

## 受け入れ基準

- [ ] `utils/masterPassword.ts` の `setMasterPassword` / `changeMasterPassword` と、テスト専用ヘルパー(`masterPasswordUiCore.ts` の `buildSetStorageFn` がテスト専用と確認できればそれも)を削除する
- [ ] `verifyMasterPassword` / `isMasterPasswordSet` / `calculatePasswordStrength` / validator は残す(本番使用中)
- [ ] `utils/__tests__/masterPassword.test.ts` の set/change 関連テストを削除または encryptionSession 経路のテストへ置換する
- [ ] 4 件ハードコード field リストが消え、canonical(`API_KEY_FIELD_NAMES`)のみが残る
- [ ] `npm run validate` が green

## テスト戦略

### 単体
- 削除後の import 走査(スクリプトまたは grep 検証)で残存参照ゼロを確認する

## 実装アプローチ

1. 削除対象関数と依存ヘルパーを特定し、テストを先に移行してから削除する
2. `masterPassword.test.ts:210,280` の「Incorrect password」系は `verifyMasterPassword` のものとして残すか encryptionSession 側へ接続する

## 制約

- 本番動作を一切変更しない(純粋な削除とテスト移行)
- 層規約(lint-layers-docs)を維持する

## 見積もり

1 SP

## Definition of Done

- [ ] 削除完了と validate green
- [ ] コードレビュー完了
