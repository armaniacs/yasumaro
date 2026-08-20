# PBI: SavedUrlRepository への統合 — Legacy Dual-Write メタデータ蓄積の崩壊

## ユーザーストーリー
開発者として、`savedUrlStore.ts`（552行）が5つの責任を抱え、`SavedUrlEntry`が30+オプションフィールドを持つ問題を解消したい。なぜなら、ADR-2026-07-27でSQLite単独移行が不可能と結論されたため、このモジュールは仍将に成長し続けるからだ。

## 優先度
- 順位: 01 / 5
- RICEスコア: (Reach=10 × Impact=3 × Confidence=0.8) / Effort=5 = 4.8
- 根拠: 1) コアデータパス（全録画・重複チェック・履歴表示が通る）2) ADR-2026-07-27で「SQLite単独では不可能」と結論され、仍将に成長する 3) 既存9箇所の呼び出しを1箇所のインターフェースに集約でき、将来のSQLite移行のアダプタ境界が明確になる

## BDD受け入れシナリオ
Scenario: SavedUrlEntry を不透明な値オブジェクトとして扱う
  Given `SavedUrlRepository` が `chrome.storage.local` の CRUD をカプセル化する
  When `SavedUrlRepository.updateTimestamp()` が呼出される
  Then 既存の全フィールド（30+）を手動で列挙する必要が消える

Scenario: クォータチェックがモジュール内に集約される
  Given `SavedUrlRepository` がエントリ追加を処理する
  When ストレージクォータを超過しようとする
  Then クォータ超過検出が repository 内部で発生し、呼び出し元は結果だけを受ける

Scenario: 楽観的ロックが1箇所に集約される
  Given 複数の呼び出し元が `savedUrlsWithTimestamps` に並行更新する
  When `SavedUrlRepository` が楽観的ロックを内部で管理する
  Then コンフリクト検出とリトライが全呼び出し元で一貫して動作する

## 受け入れ基準
- [ ] `savedUrlStore.ts` が `SavedUrlRepository` モジュールにリファクタリングされる
- [ ] `setSavedUrlsWithTimestamps()` 内の30行のプロパティ列挙ブロックが削除される
- [ ] `RecordingContextFieldMapper.ts` が不要になり、`saveMetadataStep.ts` と `BrowsingLogRecordMapper.ts` が直接データを読み込む
- [ ] 既存9箇所の呼び出し元が repository インターフェースに移行する
- [ ] ADR-2026-07-27 の結論（SQLite単独不可能）に矛盾しない設計である

## テスト戦略
- E2E: 録画→メタデータ保存→履歴表示のフルパス
- 統合: `SavedUrlRepository` × `chrome.storage.local` × `optimisticLock`
- 単体: プロパティ保持・クォータチェック・楽観的ロック・内容保持の各ロジック

## 見積もり
5人日

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
