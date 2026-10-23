# PBI: 不正形応答とタイムアウト文言の分離

## ユーザーストーリー

運用担当者として、不正形応答と実タイムアウトを区別したい。なぜなら両者が同一文言に潰され、再送・計測・問合せの切り分けができないから。

## 優先度

- 順位: 05 / 全11件
- RICE スコア: 6（Reach = 3 / Impact = 1 / Confidence = 1.0 / Effort = 0.5人日）
- 根拠: 失敗の識別性（運用の切り分け）。NN03 の後に実施（同 gateway の文言に触れるため）。

## ビジネス価値

文言が同一だと障害切り分けができない。分離で再送判断と計測が正しくなる。

## BDD受け入れシナリオ

```gherkin
Scenario: 不正形は不正形として返る
  Given 不正形の応答が返る
  When gateway が正規化する
  Then タイムアウト文言とは異なる失敗文が返る

Scenario: 実タイムアウトは従来文言のまま
  Given 実タイムアウトが起きる
  When gateway が正規化する
  Then 変更前と同一のタイムアウト文言が返る
```

## 受け入れ基準

- [x] 不正形と実タイムアウトで異なる失敗文が返る
- [x] 文言 pin テストを意図的に更新する（理由を記録する）
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- なし

### 単体テスト
- researchReportGateway の不正形・タイムアウトの table テスト

## 実装アプローチ

- **Outside-In**: 分離後の文言テストを先に書き、赤を確認してから直す

## 見積もり

0.5pt（🟢低）

## 技術的考慮事項

- 依存関係: NN03 の後に実施（同 gateway 群）
- 非機能要件: ask/regenerate の文言は変えない（REPORT のみ）

## 変更点の概要

REPORT の不正形失敗文をタイムアウト文言から分離し、pin を更新する。

## 現状と問題（file:line 付き）

- `src/messaging/researchReportGateway.ts:49-50` ― 不正形を `RESEARCH_REPORT_TIMEOUT_ERROR` に潰す
- `src/messaging/__tests__/researchReportGateway.test.ts:40-47` ― その文言を pin しているため、直すと割れる・直さなければ区別不能のまま

## 変更の理由（エラーハンドリング）

失敗の識別は運用の切り分けに直結する。ask/regenerate との不統一（'Invalid ...' vs timeout 流用）も本 PBI では REPORT 側だけ正し、全体統一は別途判断する。

## 提案コード（骨子のみ）

```typescript
// 不正形用の失敗文（例: 'Invalid EXPORT_RESEARCH_REPORT response'）を新設し、
// タイムアウト文は実タイムアウト専用に戻す。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "RESEARCH_REPORT_TIMEOUT_ERROR\|Invalid.*response" src/messaging/*.ts src/messaging/__tests__/*.ts | grep -v node_modules
```

### 落とし穴

- pin テストの更新は理由付きで行う（文言変更＝仕様変更のため）
- 全体統一（ask/regenerate 含む）は本 PBI に含めない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + 文言テスト更新通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
