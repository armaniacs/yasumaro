# PBI: Collapse the metadata-patch mappers

## ユーザーストーリー
開発者として、`RecordingContext` からストレージパッチへのマッピングが単一のフィールドインベントリで管理されている状態がほしい。なぜならフィールド名変更時に 2 箇所のマッパーを編集する必要がなくなり、バグの混入リスクが減るから。

## 優先度
- 順位: 02 / 05
- RICEスコア: 4.80（Reach=3 / Impact=1 / Confidence=80% / Effort=0.5 人週）
- 根拠: ADR 2026-07-13 (#5) で mapper 関数の抽出が決定されたが、`saveMetadataStep.ts` 側の重複が未完了。Effort が最小で ADR の未完了部分を完結できるクイックウィン。

## BDD受け入れシナリオ
Scenario: RecordingContext のフィールドが 1 箇所のインベントリでマッピングされる
  Given `RecordingContextFieldMapper` が `RecordingContext` のフィールドインベントリを定義している
  When `saveMetadataStep` がパッチを構築する
  Then フィールド名は `RecordingContextFieldMapper` の単一ソースから導出され、`BrowsingLogRecordMapper` と同じフィールドセットが使用される

Scenario: フィールド名変更が 1 箇所の修正で完了する
  Given `RecordingContextFieldMapper` に新しいフィールドが追加された
  When `saveMetadataStep` と `BrowsingLogRecordMapper` を再ビルドする
  Then 両方の出力形状が自動的に新フィールドを反映し、手動での重複編集が不要

## 受け入れ基準
- [ ] `RecordingContext` 内の「ストレージ保存対象フィールド」のマッピングロジックが共有モジュールに集約されている
- [ ] `BrowsingLogRecordMapper` が同じフィールドインベントリを再利用している
- [ ] 共有インベントリは「正規化されたフィールド値」を返し、各アダプタがパッチ用の「undefined 省略」と行用の「null 変換」を個別に処理する
- [ ] `saveMetadataStep.ts` の行数が 186 行から大幅に減少している
- [ ] 既存の `saveMetadataStep` と `saveSqliteStep` のテストがパスする

## テスト戦略
- 単体: `RecordingContextFieldMapper.test.ts` を新規作成し、全フィールドのマッピング網羅性をテスト
- 統合: `recordingPipeline` の統合テストが変更なしでパスする
- E2E: ページ閲覧→保存→SQLite 確認→chrome.storage 確認の一連の流れが正常に動作

## リスクと留意事項
- 共有インベントリの範囲を「chrome.storage パッチ + SQLite 行」に限定し、Obsidian 用フォーマットやローカル Markdown 用の変換まで広げない
- `LEGACY_DUAL_WRITE_ENABLED` 判定や `enqueuePendingWrite` 呼び出しは `saveMetadataStep` に残し、共有モジュールは純粋なマッピングに留める
- 新しいフィールド追加時は、共有インベントリに 1 箇所追加するだけで両方の保存先に反映されることを単体テストで担保する

## 見積もり
0.5 ストーリーポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（該当する場合のみ）
- [ ] `saveMetadataStep.ts` の重複マッピング行が削除されている
