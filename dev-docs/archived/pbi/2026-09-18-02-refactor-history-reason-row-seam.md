# PBI: 理由行 push 重複と cleansing bytes 解決の二重所有を seam 化する

優先度情報: 第5ループ順位 1 / RICE 8.0（Reach 4 × Impact 0.5 × Confidence 80% / Effort 0.2）。依存なし。

## ユーザーストーリー
拡張機能を保守する開発者として、履歴の理由行生成を1箇所の seam に寄せてほしい、なぜなら同一 push 文4箇所と bytes 解決2箇所の重複は将来の文言・class・fallback 順序の変更時に同期漏れを起こすから

## ビジネス価値
- 将来の表示変更（文言・class・escape 方針・fallback 順序）が1箇所の編集で全行に効く
- 測定方法: 理由行のテストが全件 green のまま、push 呼び出しが View に残らないこと

## BDD受け入れシナリオ

```gherkin
Scenario: 理由表示の見た目が変わらない
  Given 欠損エントリがある
  When 履歴パネルでそのエントリを見る
  Then 従来と同一の理由行が表示される

Scenario: bytes 解決の順序が単一所有になる
  Given original_bytesなしでcandidate_bytesありのエントリがある
  When Cleansing 行を描画する
  Then candidate への fallback が単一の解決関数で決まる
```

## 受け入れ基準
- [x] `formatDiagnosticMetadataHtml` 内に理由行の HTML 組み立てが残っていない
- [x] `original ?? candidate` の解決が View と classifier で二重に書かれていない
- [x] 既存テストが無修正で全件 green（表示の byte-identical を保証する）
- [x] 新規 seam に対する単体テストがある

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（表示差分なしのリファクタのため）

### 統合テスト
- 既存の formatDiagnosticMetadata テストが無修正で green

### 単体テスト
- resolveCleansingBytes の fallback 順序テスト（original 優先、candidate 継承、両欠損で null）
- pushReasonRow の escape と class 付与テスト

## 実装アプローチ
- **Outside-In**: 既存テストの green を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
1 （要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし。PBI 2026-09-18-01 の直上だが同ファイルの純粋な抽出であり挙動不変
- テスタビリティ: 新規 seam は純粋関数で chrome 依存なし
- 非機能要件: 追加クエリなし。描画コストは従来と同一
- セキュリティ: escapeHtml の適用箇所が seam 内に集約され、適用漏れの余地が減る

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "history-entry-token-reduction" src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts
grep -n "?? entry.candidate_bytes\|?? candidate" src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts src/dashboard/panels/asyncData/historyEntryPresentation.ts
```

### 実装手順
1. `historyEntryPresentation.ts` に `resolveCleansingBytes(entry)` を新設し `{ original, cleansed }` を返す。View の `??` 連鎖と `classifyCleansingMissing` の解決をこれに置換する
2. View 内に `pushReasonRow(parts, titleKey, reason, cssClass)` を新設し、4箇所の push 複製を置換する
3. 既存テスト無修正 green を確認し、新規 seam の単体テストを追加する

### 落とし穴
- `??` と `||` を取り違えない。正当な 0 バイトは欠損扱いにしない（PBI 2026-09-12-21 の教訓）
- AI Summary 行の class（`history-entry-ai-summary-cleansing`）と通常行の class を混同しない

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了（/review 相当の自己検証。escape と separator 維持を確認済み）
- [x] リファクタリング完了（グリーン後）
- [x] ロールバック手段の検討（挙動不変のリファクタのため、revert で従来表示に戻る）
- [x] ドキュメント更新済み（コード内コメントと本PBI。ユーザー向け説明は Phase 4 の CHANGELOG に集約）
