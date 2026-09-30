# PBI: KEK 回転経路にクロスコンテキストの相互排他を追加する

種別: fix
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワードを操作するユーザーとして、dashboard を複数タブで開いていても回転操作が競合しない状態を目指す。なぜなら、既存の再入ガードはページインスタンス単位のみで、回転経路の anchor read-modify-write と metadata 書き込みは無ロックのため、2 タブの同時実行で nested/scattered が別 KEK に割れ、検証失敗後のロールバックも無く API キーの再入力を強いられることがあるから。

## 優先度

- 順位: 9 / 13
- RICE スコア: 3.2(Reach=2 / Impact=1 / Confidence=0.8 / Effort=0.5)
- 根拠: 発生条件(dashboard 2 タブでの set/change 同時実行)は狭いが、命中時の実害は API キー損失。PBKDF2 600k の重なり窓は秒単位であり確率はゼロではない。

## 証拠(レビュー由来・反証済み)

- `src/utils/storage/encryptionSession.ts:62` — `encryptionKeyMutex` はモジュール内 Mutex
- `:225` / `:306` — acquire/release は `getOrCreateAnonymousSecretKey` 内のみ。`rotateToNewMasterPassword`(`:453-497`)は acquire しない
- `:463-467` — anchor の get→set が CAS なし
- `:415` — scattered 書き込みは意図的に per-field lock を避けた単一 `port.set`(コメント `:413-414`)
- `:482-488` — metadata 書き込みも CAS なし
- `src/dashboard/masterPassword.ts:110` / `:172-173` — `saveInFlight` はページインスタンス単位。2 タブは別コンテキストで互いに不可視
- メッセージレベル・storage レベルのローテーション直列化は存在しない(SW は set/change/remove を呼ばない)

## BDD 受け入れシナリオ

```gherkin
  Scenario: 2 タブの同時回転で後発が明示エラーで拒否される
    Given dashboard が 2 つのタブで開かれている
    When 両方で set または change を同時に実行する
    Then いずれか一方が専用エラーで失敗する
    And ciphertext が 2 つの KEK に割れて残存しない

  Scenario: 単一タブの連続操作は従来どおり成功する
    Given dashboard が 1 つのタブで開かれている
    When set → change → remove の順に実行する
    Then 全操作が成功する
```

## 受け入れ基準

- [ ] 回転全体(set/change/remove の再暗号化〜metadata 書き込み)をクロスコンテキストで直列化する(storage ベースのロック + holder token + TTL、または既存 `withOptimisticLock` の流用)
- [ ] anchor の read-modify-write を CAS 化する(他 holder が作成済みなら失敗)
- [ ] ロック取得失敗は専用エラーで即座に失敗し、UI に再試行を促す
- [ ] ロック残留(crash 時の holder 残置)を TTL で自動解放する
- [ ] 既存の nested delta 書き込み(`tx.withLock`)と干渉しない

## テスト戦略

### 統合
- 2 コンテキスト相当の並列実行で後発が失敗し ciphertext が混在しないことを検証する

### 単体
- ロック取得・TTL 解放・残留ロックの検証する

## 実装アプローチ

1. `rotateToNewMasterPassword` と `removeMasterPassword` の全体を storage ベースの回転ロックで囲む
2. anchor 作成を「ロック取得後の再読み取り + CAS」に変更する
3. `removeMasterPassword` の metadata 削除(`:755`)も同一ロック内に含める

## 制約

- 既存 `StorageTransaction` の CAS 機構と設計を合わせる(重複実装を避ける)
- ロックはユーザー可視の storage key として汚染を最小化する
- async/await のみ。ESM import は `.js` 拡張子

## 見積もり

2 SP

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
