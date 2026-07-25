# PBI: PBKDF2検証のレガシーパス（iteration未保存ユーザー）に残るタイミングサイドチャネルを解消する

**作成日**: 2026-07-25
**優先度**: High
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（マスターパスワード検証ロジックの変更。移行期のユーザー体験に影響しないよう慎重に扱う）

---

## 背景

Checking Team レビュー（2026-07-25）の Red Team Leader からの High指摘。`verifyPasswordWithPBKDF2()` は新しいiteration count（600,000）を先に試し、失敗した場合のみレガシー（100,000）を試すため、レスポンス時間の違いからiteration countを推測できるタイミングサイドチャネルがある、という指摘。

**フェーズ0の事前調査により、この指摘は部分的に解消済みであることが判明している**（`src/utils/crypto.ts:368-390`, 2026-07-25時点）。VULN-019の対応として：
- `storedIterations` が渡される通常パス（`iterations !== undefined`、374-379行）は **既に1回のみのPBKDF2計算で定数時間性を確保**しており、コメントにも明記されている
- 呼び出し元 `src/utils/storage/encryptionSession.ts:269` は常に `StorageKeys.MASTER_PASSWORD_KDF_ITERATIONS` から取得した `storedIterations` を渡している

**残存するリスク**: `iterations` が `undefined` の場合（380-388行、レガシーパス）のみ、レビュー指摘通りの新→旧の二段階試行が残る。これは `MASTER_PASSWORD_KDF_ITERATIONS` が保存されていない、**VULN-019修正前に作成された古いマスターパスワードを持つユーザー**に限定される。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "verifyPasswordWithPBKDF2\|storedIterations" src/utils/crypto.ts src/utils/storage/encryptionSession.ts
grep -n "MASTER_PASSWORD_KDF_ITERATIONS" src/utils/storage.ts
```

`MASTER_PASSWORD_KDF_ITERATIONS` が未設定のユーザーが実際にどの程度存在しうるか（既存インストールベースでの移行状況）を踏まえ、対応の緊急度を判断する。新規ユーザーはこのパスを通らない。

## 受け入れ基準（BDD）

```gherkin
Scenario: iteration未保存のレガシーユーザーでも定数時間で検証される
  Given MASTER_PASSWORD_KDF_ITERATIONS が保存されていない（レガシー）ユーザー
  When verifyPasswordWithPBKDF2(password, storedHash, salt, undefined) を呼ぶ
  Then 新旧どちらのiteration countであっても、計算回数・処理時間がパスワードの正誤に依存しない一定のパターンになる

Scenario: 両方のiteration countで計算してから比較する
  Given iterations が未指定である
  When 検証処理を実行する
  Then ENVELOPE_ITERATIONS と LEGACY_PBKDF2_ITERATIONS の両方のハッシュを常に計算し、どちらか一致すれば有効とする（早期リターンしない）

Scenario: 通常パス（iteration保存済み）の挙動は変わらない
  Given MASTER_PASSWORD_KDF_ITERATIONS が保存されているユーザー
  When verifyPasswordWithPBKDF2 を呼ぶ
  Then 既存通り1回のみの計算で検証される（レガシーパスの変更が影響しない）
```

## 受け入れ基準
- [ ] `verifyPasswordWithPBKDF2` のレガシーパス（`iterations === undefined`）を、新旧両方のiteration countで**常に**ハッシュ計算してから、定数時間比較で判定する形に変更する（早期リターンを排除）
- [ ] 通常パス（iterations指定済み）の挙動・パフォーマンスは変更しない
- [ ] 既存の `crypto.test.ts` / `encryptionSession` 関連テストが全てパスする
- [ ] レガシーパスの処理時間が、新iteration一致時・旧iteration一致時・不一致時のいずれでも統計的に近い時間になることを確認するテストを追加する

## テスト戦略（t_wadaスタイル）

### 単体テスト
- レガシーパスで新iteration一致・旧iteration一致・両方不一致の3ケースそれぞれで `isValid`/`needsRehash` が正しく返ることを確認
- 通常パス（iterations指定）の挙動が変更されないことを確認する既存テストの回帰確認

### 統合テスト
- `encryptionSession.ts` 経由でのマスターパスワード検証フロー（ログイン）が回帰しないことを確認

## 実装アプローチ

1. `crypto.ts:380-388` のレガシーパスを、早期リターンする if-else から「両方計算してから比較」する形に書き換える
2. `constantTimeCompare` を両方のハッシュ結果に対して実行し、結果をOR結合する際もタイミングが分岐しないよう注意する
3. テスト追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/utils/storage/encryptionSession.ts`
- テスタビリティ: 既存の `crypto.test.ts` が土台
- 非機能要件: セキュリティ（タイミング攻撃耐性）

## Definition of Done
- [ ] レガシーパスが常に両方のiteration countで計算し定数時間比較する形になっている
- [ ] 通常パスの挙動・パフォーマンスが変わっていない
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Red Team Leader指摘、High。主要部分はVULN-019で対応済み、レガシーパスのみ残存）
- 対象コード: `src/utils/crypto.ts:368-390`
