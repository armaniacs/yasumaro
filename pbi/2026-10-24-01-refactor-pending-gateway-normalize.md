# PBI: pendingRecordGateway normalizeの共有化

## ユーザーストーリー

保守担当者として、取り残された独自検査を共有検査に寄せたい。なぜなら空失敗・空白error・配列偽装の3破形がここだけ素通しするから。

## 優先度

- 順位: 01 / 全8件
- RICE スコア: 12（Reach = 3 / Impact = 2 / Confidence = 1.0 / Effort = 0.5人日）
- 根拠: deletion testで消えるshallowさが確定。Effort最小で破形耐性が上がるため最初の一手。

## ビジネス価値

破形素通しは将来の未検出不整合になる。1行委譲で全gatewayが同一耐性になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 3破形が共有検査で落ちる
  Given 空失敗・空白error・配列偽装の応答がある
  When PENDING_RECORDのnormalizeが処理する
  Then 固有文言の失敗として扱われる

Scenario: 正常応答は変更前と同一
  Given 正形の応答がある
  When 処理する
  Then 変更前と同一に処理される
```

## 受け入れ基準

- [ ] normalizeが共有検査への1行委譲になる（固有文言のみ引数）
- [ ] 3破形のテストがある
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- なし

### 単体テスト
- 共有検査流儀の破形table（既存3 gatewayと同一形）

## 実装アプローチ

- **Outside-In**: 破形の失敗テストを先に書き、赤を確認してから直す

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 正常応答の処理は不変

## 変更点の概要

`pendingRecordGateway.ts:68-74` を `asSuccessResponse` への1行委譲に置換する。

## 現状と問題（file:line 付き）

- `src/messaging/pendingRecordGateway.ts:68-74` ― inline normalize（success真偽のみ・error素通し）
- `src/messaging/normalizeGatewayResponse.ts:28-47` ― 共有検査（型＋非空白error＋配列拒否）
- 他3 gateway（`:44-46`・`:52-54`・`:49-51`）は委譲済み

## 変更の理由（DRY・depth）

同一interfaceなのにimplementationだけが古い。消しても失われる振舞いはない（deletion test済み）。

## 提案コード（骨子のみ）

```typescript
// normalizePendingRecordResponse →
// asSuccessResponse<PendingRecordResponse>(raw, 'Invalid PENDING_RECORD response')
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "normalize" src/messaging/pendingRecordGateway.ts
```

### 落とし穴

- 固有文言は変えない（他gatewayと同一規約 `Invalid <MESSAGE_TYPE> response` に合わせる）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
