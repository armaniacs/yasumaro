# PBI: マスターパスワード系テストの空振り assertion を修正し read-back 失敗経路をカバーする

種別: test
状態: 未着手
上流: `pbi/2026-09-30-00-backlog-adversarial-review-0930.md`

## ユーザーストーリー

マスターパスワード機能を改修する開発者として、テストが本番の契約を実際に検証している状態を目指す。なぜなら、本番が呼ばないシンボルを assert した空振りテストや、本番で到達不能な状態を構築したテストが「緑の偽の保証」を与え、回帰を見逃すから。

## 優先度

- 順位: 10 / 13
- RICE スコア: 2.0(Reach=1 / Impact=0.5 / Confidence=1.0 / Effort=0.25)
- 根拠: 直接のユーザー価値は薄いが、他の全修正(順位 1〜9)の検証基盤となる。同点 3 件(10/11/12)の中で検証基盤として最優先。

## 証拠(レビュー由来・確認済み)

- `src/dashboard/__tests__/masterPassword-branches.test.ts:274` — テスト名は「mode=set requires matching confirm password (returns early on mismatch)」だが唯一の assertion が `expect(setMasterPassword).not.toHaveBeenCalled()`。`setMasterPassword` は utils 版のモック(`:40-49` の `vi.mock('../../utils/masterPassword.js')`)で、本番コントローラが呼ぶのは `setMasterPasswordService`(`:93` の encryptionSession 版 alias)のため assertion は常に成立(空振り)
- 同種: `masterPassword.test.ts:780` / `:804` / `:893`
- `masterPassword.test.ts:856-874` — 「save 失敗時に checkbox を復元」のテストが、本番で set モード save 時に存在しない状態(`checkbox.checked = false` を :866 で手動構築)を検証しており、本番のロールバック(実際には true→true の no-op)を検出できない
- `src/utils/storage/encryptionSession.ts:438` — `REENCRYPT_VERIFY_FAILED` の全一致は定義行のみでテスト 0 件。「認証メタデータは read back 確認が通るまで書かない」(`encryptionSession.ts:561`)という契約の失敗側が未定義
- `encryptionSession-reencrypt.test.ts:5-6` — ヘッダが "read-back verification" を謳うが失敗経路は未実行

## BDD 受け入れシナリオ

```gherkin
  Scenario: 空振り assertion が本番シンボルを検証する
    Given masterPassword-branches.test.ts の confirm mismatch テストがある
    When テストが実行される
    Then assertion は setMasterPasswordService(encryptionSession 版)に対して行われる

  Scenario: read-back 失敗時に metadata が書かれないことが検証される
    Given read-back 検証が不一致になる状態が注入できる
    When set または change を実行する
    Then REENCRYPT_VERIFY_FAILED で失敗する
    And MASTER_PASSWORD_SALT/HASH/ENABLED は書かれない
```

## 受け入れ基準

- [ ] `masterPassword-branches.test.ts:274` を `setMasterPasswordService` への assert に修正する
- [ ] 同種の空振り assertion(`masterPassword.test.ts:780` / `:804` / `:893`)を本番シンボルへ修正する
- [ ] `masterPassword.test.ts:856-874` を本番到達可能なシナリオ(set モーダルを開いた状態から失敗)へ書き換える
- [ ] `REENCRYPT_VERIFY_FAILED` の失敗経路テストを追加する(read-back 不一致の注入方法を実装する)
- [ ] 修正後、当該テストが意図した契約を壊す変更で赤くなることを確認する(テストのテスト)

## テスト戦略

### 単体
- 上記すべてが単体テストの修正・追加である

## 実装アプローチ

1. assertion 対象のシンボルを修正する
2. read-back 不一致の注入は、storage モックに「書き込み後に値を別 ciphertext で置き換える」フックを入れるか、port を差し替えて read back の値を汚す
3. `856-874` は順位 7 の PBI でロールバックが修正された後の正しい期待値(トグル前の状態への復元)に合わせる

## 制約

- テスト修正が本番コードの挙動を変えない(assertion 修正のみ)
- `dev-docs/TEST_RULE.md` の規約に従う(実時間待ちの禁止等)

## 見積もり

1 SP

## Definition of Done

- [ ] 全修正済みテストが green
- [ ] 意図的破壊テスト(契約を壊すと赤になる)の確認済み
- [ ] コードレビュー完了
