# readSettingsSnapshot の嘘型解消（refactor）

## 1. タイトル + 種別

- **タイトル**: `readSettingsSnapshot` の戻り型を正直な型に変更し、二重キャストとコメント drift を解消する
- **種別**: refactor（挙動不変・境界型の修正のみ）
- **見積もり**: 1.5 SP

## 2. 優先度

- **優先度**: 順位 2
- **RICE**: R4 / I2 / C1.0 / E1.5 → **5.3**
- **根拠**:
  - 境界型の嘘は契約違反を見えなくする。`Promise<Settings>` という宣言に対して実体は無検証の `Record<string, unknown>` であり、`Settings` 型が契約として一度も機能していない
  - 二重キャストが構造的に強制される。`Settings` を受け取った全消費者が `as unknown as` で逆キャストせざるを得ず、型システムが安全ではなくノイズになっている
- **依存**: なし。ただし NN08 がこの PBI の着地後に `contentKernel.ts` を触る（同一ファイルの順序依存）。本 PBI を先に完了させること

## 3. ユーザーストーリー

**コンテンツバンドルの保守担当者として**、スナップショット読み取り関数の戻り型が実体と一致していてほしい。なぜなら、嘘型と二重キャストがあると `Settings` 型の変更がコンパイル時に検出されず、契約違反が黙って通過してしまうから。

## 4. 背景

スナップショット読み取り経路（PBI 2026-09-28-30 で導入）は中身を検証せず `Record<string, unknown>` をそのまま `as Settings` で返す嘘型。呼び出し側はテーブル駆動マッピング（`applySettingsTable(pageState, Record<string, unknown>)`）に渡すため `Settings` 型が一度も役に立たず、全消費者が `as unknown as` で逆キャストを強制される。テスト側も同じキャスト。さらに kernel 側のコメントがスナップショット側の実装と矛盾している（コメント drift）。

該当箇所（全 file:line 検証済み）:

- `src/utils/storage/settingsSnapshot.ts:27` — `readSettingsSnapshot(port): Promise<Settings>` の宣言。実体は無検証 Record
- `src/utils/storage/settingsSnapshot.ts:42` — `return merged as Settings;`（`merged` は無検証 `Record<string, unknown>`）
- `src/content/contentKernel.ts:161` — `(await readSettingsSnapshot(this.storage)) as unknown as Record<string, unknown>`（二重キャスト）
- `src/utils/storage/__tests__/settingsSnapshot-authority-parity.test.ts:35` と `:65` — テストも同一の二重キャスト
- **コメント drift**: `src/content/contentKernel.ts:159-160`（「migration-folded and defaults-filled」）vs `src/utils/storage/settingsSnapshot.ts:39-41`（「No DEFAULT_SETTINGS fill: callers keep their own fallbacks」）。実装は後者が正。スナップショット側はデフォルトを埋めない

## 5. BDD シナリオ

### シナリオ 1: 戻り型が実体と一致する

```gherkin
Given readSettingsSnapshot の戻り型が Record<string, unknown>（または opaque な SettingsSnapshot 型）である
When 型チェックを実行する
Then 戻り値に対する `as Settings` の嘘キャストが存在しないこと
And contentKernel.ts:161 の `as unknown as Record<string, unknown>` が存在しないこと
And parity テスト（settingsSnapshot-authority-parity.test.ts:35, :65）の二重キャストが存在しないこと
```

### シナリオ 2: 挙動が完全に不変である

```gherkin
Given authority-parity テストの既存 pin（state matrix・absence 保持・write なし）が維持されている
When リファクタリング後に parity テストを実行する
Then すべてのテストが無変更（pin 部分のみ）で通過すること
And authoritative な blob では scattered キーを読まないこと
And 非 authoritative な場合に scattered キーが blob 配下に fold されること
And absent は absent のまま維持され（デフォルトを埋めない）、書き込みが発生しないこと
```

### シナリオ 3: コメントが実装と一致する

```gherkin
Given contentKernel.ts のスナップショット読み取り前のコメントが修正されている
When コメントを読む
Then 「defaults-filled」という誤った記述が「no default fill（デフォルトを埋めない）」に訂正されていること
And settingsSnapshot.ts:39-41 の実装と矛盾していないこと
```

## 6. 受け入れ基準

- [x] `readSettingsSnapshot` の戻り型が `Promise<Record<string, unknown>>`（または opaque な `SettingsSnapshot` 型）に変更されている
- [x] `settingsSnapshot.ts:42` の `as Settings` キャストが削除されている
- [x] `contentKernel.ts:161` の `as unknown as Record<string, unknown>` 二重キャストが削除されている
- [x] `settingsSnapshot-authority-parity.test.ts:35` と `:65` の二重キャストが削除されている
- [x] `contentKernel.ts:159-160` のコメントが「no default fill」に訂正され、`settingsSnapshot.ts:39-41` と矛盾しない
- [x] `isSnapshotAuthoritative`（settingsSnapshot.ts:20-25）の authority 判定ロジックはモジュール内にそのまま維持されている
- [x] parity テストの pin（state matrix、absence 保持、write なしの検証）が無変更で維持されている
- [x] 挙動が完全に不変である（既存テスト全通過、ロジック変更なし）

## 7. テスト戦略

1. **parity/golden pin 先行**: 着手前に既存の `settingsSnapshot-authority-parity.test.ts` の pin を確認し、リファクタリング中も失敗しないことを安全網として使う
2. **authority-parity テストの pin 維持**: state matrix による canonical predicate との一致 pin、absence 保持 pin、write なし pin は無変更で維持する（pin 部分の変更は許可しない。二重キャストの削除のみ行う）
3. **type-check 通過**: `npm run type-check` を通し、`as unknown as` の逆キャストが全消費者から消えたことをコンパイル時に確認する
4. **挙動不変の確認**: `npm run validate`（type-check + test）で既存テスト全通過を確認する

## 8. 見積もり

**1.5 SP** — 型変更とキャスト削除、コメント訂正のみでロジック変更なし。影響範囲は `settingsSnapshot.ts`、`contentKernel.ts`、parity テストの 3 ファイル

## 9. DoD

- [x] 受け入れ基準 8 件すべて充足
- [x] `npm run validate`（type-check + test）が green
- [x] parity テストが pin 無変更で通過
- [x] リポジトリ内に `as unknown as` による `readSettingsSnapshot` 戻り値の逆キャストが残っていない（grep で確認）
- [x] コメント drift 解消（kernel 側コメントとスナップショット側実装が一致）
- [x] 既存機能への影響ゼロ（挙動不変）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 2（R4 / I2 / C1.0 / E1.5 → 5.3）
- 依存: なし。NN08 がこの PBI の着地後に `contentKernel.ts` を触るため、本 PBI を先に完了させること
