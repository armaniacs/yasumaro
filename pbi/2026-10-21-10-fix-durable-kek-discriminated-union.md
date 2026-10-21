# PBI: durableKeyStore 戻り値の判別 union 化（KEK 全滅と一時的不在の区別）

## ユーザーストーリー

暗号化鍵の失効を判断できる性質のデータを持つユーザーとして、IndexedDB の不在と取得失敗が区別され、KEK チェーンの終端が理由付きで観測できることがほしい、なぜなら不在（fresh install）と失敗（永続ストア喪失）を同一視する fail-open は、既存のラップ済み署名鍵の孤児化を理由なく起こすから。

## 優先度

- 種別: 🔧非機能追加（fix・owner 判断 PBI 2026-10-18-15 の選択肢 3）
- 難易度: 🟡中
- 副作用: 🔴なし（挙動不変・観測性のみ。idbKeystoreContract.test.ts の期待値書き換えが不可避）
- 出典: [pbi/2026-10-18-15-fix-hmac-kek-fail-open.md](2026-10-18-15-fix-hmac-kek-fail-open.md)（判定 CONFIRMED・Reach 30 に下方修正済み）。なぜなぜ分析 /tmp/whywhy/owner-pbi.md（分析 1-3）2026-10-21

## 前提（owner PBI 15 の進捗）

- 選択肢 2（HMAC_SECRET の隔離）は **実装済み**: commit `ef36ce32`、encryptionSession の隔離経路 + 専用テスト 4 件 pin 済み
- 選択肢 1（HEK 回復 UX）は owner 判断（2026-10-21）で **consent 再同意流用のみ** と裁定: 既存の signatureInvalid → needsReconsent → モーダル経路で説明と再同意が完結し、追加 UI は不要。master password による KEK 再導出は未配線（deriveHmacWrappingKey の production 呼び出し元ゼロ）のため不採用

## 実装内容

1. loadDurableWrappingKey（durableKeyStore）の戻り値を「absent（null）」と「failure（reject）」の判別 union にし、catch での丸めを排除する（idbKeyStorage は既に区別しており、丸めは durableKeyStore の catch のみ）
2. 唯一の production 呼び出し点（hmacKeyStore の KEK 候補チェーン終端）で分岐する（挙動不変・観測性のみ。失敗理由をログに残す）
3. idbKeystoreContract.test.ts の期待値を判別 union に更新する

## 受け入れ基準（BDD）

```gherkin
Scenario: 不在と失敗が区別される
  Given IndexedDB ストアが存在しない
  When loadDurableWrappingKey を呼ぶ
  Then absent として返る

  Given IndexedDB の get が reject する
  When loadDurableWrappingKey を呼ぶ
  Then failure として返る
    And 理由がログに残る

Scenario: 呼び出し側の挙動は変わらない
  Given KEK 候補チェーンが全滅する
  When 新しい KEK を生成する
  Then 従来どおり生成・保存される（挙動不変）
```

## テスト戦略

- Red-first: 判別 union の契約テストを先に書く
- 既存の idbKeystoreContract.test.ts と hmacKeyStore 系テストで pin された挙動を fixture として確認する

## 関連

- [pbi/2026-10-18-15-fix-hmac-kek-fail-open.md](2026-10-18-15-fix-hmac-kek-fail-open.md)（親 PBI・選択肢 2 実装済み）
- src/utils/crypto/durableKeyStore.ts・src/utils/crypto/hmacKeyStore.ts
