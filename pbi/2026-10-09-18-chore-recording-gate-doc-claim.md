# recordingGateTable の stale doc claim 修正（chore）

## 1. タイトル + 種別

- **タイトル**: `recordingGateTable.ts` が実在しない `tabUtils.isRecordable` を「byte-for-byte mirror」と参照し続けているコメントを実態（`recordSession.ts` の `isRecordableTab` 利用）に合わせる
- **種別**: chore（コメントのみ・コード変更なし）
- **見積もり**: 0.5 SP

## 2. 優先度

- **優先度**: 順位 18
- **RICE**: R2 / I0.5 / C1.0 / E0.5 → **2.0**
- **根拠**:
  - タブ機構削除ラウンド（pbi-1005-29/31）前後で popup の `isRecordable` が gate table 経由の `isRecordableTab` に置換されたが、gate table 側コメントは削除済み関数を参照し続けている
  - 読み手が存在しない関数との対応を探す誤導。Impact は小（文書整合）だが Effort 0.5 のクイックウィン
- **依存**: **なし**

## 3. ユーザーストーリー

**recording gate の保守担当者として**、コメントが実在する消費者だけを参照していてほしい。なぜなら、存在しない関数との対応を探す時間が無駄になり、gate の所有関係の理解を誤らせるから。

## 4. 背景

タブ機構削除ラウンド（pbi-1005-29/31）前後で popup の `isRecordable` が gate table 経由の `isRecordableTab` に置換されたが、recordingGateTable 側のコメントは削除済み関数を参照し続けている。`tabUtils.ts` を読んだ読み手は存在しない関数との対応を探すことになる。

該当箇所（全 file:line 検証済み）:

- `src/utils/recordingGateTable.ts:250`（「It mirrors tabUtils.isRecordable byte-for-byte.」— `:247` の「shared by popup (isRecordable)」も同様に実体なし）
- `src/popup/tabUtils.ts:1-33`（実装は `getCurrentTab` / `getActiveTabUrl` / `getDomainForUrl` のみ。`isRecordable` は存在しないことを全文読んで確認済み）
- 現実の消費者: `src/popup/recordCurrentPage/recordSession.ts:94` の `isRecordableTab` 利用

改善案: 記述を実消費者に差し替える 1 行修正（現実は `src/popup/recordCurrentPage/recordSession.ts:94` の `isRecordableTab` 利用）か、文の削除。コード変更なし。

## 5. BDD シナリオ

### シナリオ 1: コメントが実消費者を参照する

```gherkin
Given recordingGateTable.ts のコメントを確認する
Then 実在しない tabUtils.isRecordable への言及が残っていないこと
And 実消費者（recordSession.ts の isRecordableTab）または適切な記述に置き換わっていること
```

### シナリオ 2: コードは不変である

```gherkin
Given 変更がコメントのみである
When npm run validate を実行する
Then type-check とテストが green であること
```

## 6. 受け入れ基準

- [ ] `src/utils/recordingGateTable.ts:250`（および `:247`）の実在しない `tabUtils.isRecordable` 参照が除去または実消費者参照に修正されている
- [ ] コード（実行ロジック）に変更がない
- [ ] `npm run validate` が green である

## 7. テスト戦略

1. **コード不変の確認**: 変更がコメントのみであることを diff で確認する
2. **validate green**: `npm run validate`（type-check + test）で全体通過を確認する

## 8. 見積もり

**0.5 SP** — コメント 1〜2 行の修正。

## 9. DoD

- [ ] 受け入れ基準 3 件すべて充足
- [ ] 実在しない関数参照が残っていない
- [ ] `npm run validate`（type-check + test）が green

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 18（R2 / I0.5 / C1.0 / E0.5 → 2.0）
- 依存: なし
