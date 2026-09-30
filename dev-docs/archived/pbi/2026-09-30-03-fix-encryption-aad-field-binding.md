# PBI: 暗号化に AAD を導入して ciphertext をフィールドに束縛する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

API キーを暗号化して保存しているユーザーとして、ciphertext が保存位置のフィールドに束縛されてほしい。なぜなら、AAD が無い現状ではストレージ書込権限を持つ攻撃者がフィールド間で ciphertext を入れ替えられており、例えば gemini スロットに openai の ciphertext を置かれるとユーザーの OpenAI キーが Gemini の送信先へ流れるから。

## 優先度

- 順位: 3 / 13
- RICE スコア: 10.7(Reach=10 / Impact=2 / Confidence=0.8 / Effort=1.5)
- 根拠: 防御効果は全 API キー保持者に及ぶが、既存 ciphertext との互換(v1 読み取り継続)と envelope versioning の migration で工数が最大級。

## 証拠(レビュー由来・反証済み)

- `src/utils/crypto/primitives.ts:140-147`(encrypt)と `:173-180`(decrypt)— `{ name, iv }` のみで `additionalData` は src 配下に 0 件
- `src/utils/crypto/types.ts:10-13` — `EncryptedData { ciphertext, iv }` はフィールド識別子・version を持たない
- 単一 KEK(`encryptionSession.ts:512-537`)が全フィールドを覆い、per-field 鍵は存在しない
- 復号後のフィールド束縛検証なし(`settingsMigration.ts:444-449` は同一 key で全 field を復号しそのまま代入)
- 消費側にも検出なし(`OpenAIProvider.ts:69` は無検証キャスト、provider 側にキー形式チェックなし)

## BDD 受け入れシナリオ

```gherkin
  Scenario: フィールド間の ciphertext 入れ替えが検出される
    Given gemini と openai の API キーが v2 envelope で保存されている
    When 2 フィールドの ciphertext と iv を入れ替える
    Then どちらの読み出しも復号失敗となり平文に置き換わらない

  Scenario: 既存 v1 ciphertext は引き続き読める
    Given v1 形式(AAD なし)で暗号化されたキーがある
    When 読み出す
    Then v1 パスで復号され、次回書き込み時に v2 へ再暗号化される
```

## 受け入れ基準

- [x] 新規暗号化は AAD に「保存位置のフィールド識別子」を含む(envelope 本体に埋め込まない — 埋め込むと攻撃者が ciphertext+iv+AAD をセットで入れ替えられるため)
- [x] 復号は呼び出し側が保存位置のフィールド識別子を渡す形へ更新される
- [x] v1 envelope の判別とフォールバック復号を実装し、既存データが全件読めることを移行テストで担保する
- [x] KEK ローテーション(`reencryptApiKeysToKek`)と settingsMigration の再暗号化経路で AAD が正しく引き継がれる
- [x] v1→v2 の再暗号化時にデータロスがない(read back 検証)

## テスト戦略

### E2E
- set/change/remove を通して既存キーが保持されることを検証する(既存 spec の維持)

### 統合
- v1 データからの読み取りと touch 時の v2 移行を検証する
- ciphertext 入れ替え攻撃のシミュレーションで復号失敗することを検証する

### 単体
- encrypt/decrypt の AAD 付きラウンドトリップ、AAD 不一致で失敗することを検証する

## 実装アプローチ

1. `EncryptedData` に version フィールドを追加し、v2 は AAD あり・v1 は AAD なしと判別できるようにする
2. `encryptApiKey` / `decryptApiKey` にフィールド識別子引数を追加し、呼び出し元(`SettingsRepository` / `settingsMigration` / `encryptionSession`)を更新する
3. AAD は格納位置のキー名から復元する(envelope 内に保存しない)
4. 既存 v1 の読み取りは継続し、書き込み時に v2 へ移行する(ストレージ内の一斉移行はしない)

## 制約

- envelope 変更は `src/utils/crypto/envelope.ts` のバージョニング規約に従う
- 移行中に旧形式のデータが読めなくなる変更をしない
- async/await のみ。ESM import は `.js` 拡張子

## 見積もり

5 SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存データの読み取り互換テストが green
- [ ] コードレビュー完了
