# PBI: PBKDF2 iteration 数に上下限を設けて unlock バイパスと DoS を防ぐ

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードで API キーを保護しているユーザーとして、保存された KDF パラメータが改変されても unlock が成立せず、拡張機能が固まらない状態を目指す。なぜなら、salt/hash/iterations が互いに結合されていない生の値として扱われているため、iterations を 1 に改変すれば攻撃者の hash で unlock が通るし、2^31 に改変すればサービスワーカーが数十秒単位で固まるから。

## 優先度

- 順位: 4 / 13
- RICE スコア: 8.0(Reach=2 / Impact=1 / Confidence=1.0 / Effort=0.25)
- 根拠: 修正は最小(バウンド検査の追加)だが unlock バイパス経路を塞ぐ。同点の順位 5 と比べセキュリティ修正を優先。

## 証拠(レビュー由来・反証済み)

- `src/utils/storage/encryptionSession.ts:616` — `storedIterations` はキャストのみで検証なし
- `:625` → `src/utils/crypto/primitives.ts:395-400` — `iterations` をそのまま `hashPasswordWithPBKDF2` へ素通し。floor/ceiling/型チェックなし
- `src/utils/storage/encryptionSession.ts:84-89` → `:108` — `deriveKeyFromPassword` の stored iterations も上限なしで導出へ直結
- `src/utils/crypto/envelope.ts` には `MIN_ENVELOPE_ITERATIONS` / `MAX_ENVELOPE_ITERATIONS`(1〜6,000,000)が存在するが、unlock / KEK 導出経路には掛からない
- 正規の書き込み値は `ENVELOPE_ITERATIONS`(600k)のみのため、範囲外は必ず改変・破損

## BDD 受け入れシナリオ

```gherkin
  Scenario: iteration 数 1 に改変されたメタデータで unlock が通らない
    Given MASTER_PASSWORD_KDF_ITERATIONS が 1 に改変されている
    When unlockWithPassword が呼ばれる
    Then 改変値では検証せず破損エラーで失敗する
    And MASTER_PASSWORD_HASH / SALT は変更されない

  Scenario: 巨大な iteration 数で導出が固まらない
    Given MASTER_PASSWORD_KDF_ITERATIONS が 2147483647 に改変されている
    When キー導出が必要な操作が呼ばれる
    Then 改変値を使わず破損エラーで即座に失敗する
```

## 受け入れ基準

- [x] unlock 経路(`unlockWithPassword`)と導出経路(`deriveKeyFromPassword`)の両方に floor(`LEGACY_PBKDF2_ITERATIONS`)と ceiling(`MAX_ENVELOPE_ITERATIONS` 相当)を適用する
- [x] 範囲外の値は既定値へのフォールバックではなく fail-closed(CORRUPTION 系エラー)とする
- [x] floor 未満は「弱 KDF 強制」、ceiling 超過は「DoS 強制」の双方を遮断する
- [x] 範囲外を検知したことをログに残す(値自体は出力可、秘密は出力しない)
- [x] 型チェック(非整数・負値・NaN・文字列)も fail-closed 扱いとする

## テスト戦略

### 単体
- バウンド境界(floor 未満 / floor / 正規 600k / ceiling / ceiling 超)で分岐を検証する
- 非整数・NaN・文字列の入力で失敗することを検証する

### 統合
- 改変メタデータからの unlock が失敗し metadata が不変であることを検証する

## 実装アプローチ

1. `primitives.ts` の `verifyPasswordWithPBKDF2` / `hashPasswordWithPBKDF2` 入口、または呼び出し側で一元検査する(envelope.ts の MIN/MAX を再利用)
2. `encryptionSession.ts:84-89` の stored 読み取り後に同じバウンドを適用する

## 制約

- 正規データ(600k)および legacy(100k)の unlock を壊さない
- async/await のみ。ESM import は `.js` 拡張子

## 見積もり

1 SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
