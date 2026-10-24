# PBI: 退避形状の照会集約

## ユーザーストーリー

保守担当者として、退避の能力照会と形状選択を1箇所に集めたい。なぜなら4形状×能力規則×復元経路に分散し、呼び側が全部学ぶから。

## 優先度

- 順位: 06 / 全8件
- RICE スコア: 4.8（Reach = 6 / Impact = 2 / Confidence = 0.8 / Effort = 2.0人日）
- 根拠: NN02 の後に実施（settingsExportImportに触れるため）。Confidence 0.8 は集約粒度の設計判断残り。アーカイブ専属のため完全統一はしない。

## ビジネス価値

退避・復元が1つのinterfaceで足り、形状追加・能力変更が1箇所に集まる。

## BDD受け入れシナリオ

```gherkin
Scenario: 形状選択が1箇所で動く
  Given 退避 wants とadapter能力がある
  When 退避する
  Then 適切な形状で処理される

Scenario: 復元が形状から分岐する
  Given 各形状の退避がある
  When 復元する
  Then 変更前と同一に復元される
```

## 受け入れ基準

- [ ] 能力照会と形状選択が単一moduleに集まる
- [ ] 各codecが内部seamに残る
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 退避・復元フローテスト維持

### 単体テスト
- 照会のtableテスト新規

## 実装アプローチ

- **Outside-In**: 照会の失敗テストを先に書き、赤を確認してから集約する

## 見積もり

2pt（🟡中）

## 技術的考慮事項

- 依存関係: NN02・NN07 の後に実施（settingsExportImport・dbMaintenanceに触れるため）
- 非機能要件: アーカイブのOPFS専属は変えない。各形状のdecode不変

## 変更点の概要

照会集約に留め、codecは内部に残す。

## 現状と問題（file:line 付き）

- `src/offscreen/dbMaintenance.ts:44-61` ― binary .db
- `src/offscreen/exportEnvelope.ts:22-55` ― JSON envelope
- `src/utils/storage/settingsBackup.ts:34-87` ― 世代選択・復元
- `src/offscreen/archiveStaging.ts:41-66` ― staging 14操作
- `src/offscreen/StorageBackend.ts:68-147` ― 能力規則
- `src/offscreen/OpfsWorkerBackend.ts:256-311` ― descriptor設置
- `src/utils/settingsExportImport.ts:55-65` ― 暗号化形状

## 変更の理由（depth）

形状集合体としてのinterface肥大。照会集約で解く（完全統一はしない）。

## 提案コード（骨子のみ）

```typescript
// 能力照会＋形状選択の単一interface。復元は形状からdispatch。
// codec群は内部seamに残す。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "supportsArchive\|BINARY_\|ARCHIVE_UNSUPPORTED" src/offscreen/*.ts | grep -v __tests__ | head
```

### 落とし穴

- アーカイブ専属を崩さない
- 各形状の復元を変えない（往復テストで固定）

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過 + 照会table新規通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み
