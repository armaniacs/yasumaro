# PBI: GDPR 完全準拠 — 物理削除 & プライバシーポリシー更新

## ユーザーストーリー
**プライバシー意識の高いユーザー**として、**「削除」操作が完全にデータを消去する**ことを保証してほしい、なぜなら**GDPR Art.17の削除権（忘れられる権利）を行使したい**から

## ビジネス価値
- GDPR/CCPAの法的リスクを排除
- ユーザー信頼の向上（「削除=完全消去」の保証）
- プライバシーポリシーと実装の整合性確保

## BDD受け入れシナリオ

```gherkin
Scenario: ユーザーがレコード削除すると物理的に消去される
  Given ダッシュボードに閲覧履歴レコードが表示されている
  When ユーザーが「削除」ボタンをクリックする
  Then レコードがbrowsing_logsテーブルから物理DELETEされる
  And exportDb()の結果にも含まれない
  And FTS5インデックスからも削除される

Scenario: 「Delete All Data」で全データが完全消去される
  Given ユーザーが1000件の閲覧履歴を持つ
  When 「Delete All Data」を実行する
  Then browsing_logsテーブルがTRUNCATEされる
  And FTS5仮想テーブルも完全にクリアされる
  And OPFS上のWALファイルも解放される

Scenario: プライバシーポリシーがSQLite/OPFSを反映している
  Given ユーザーがPRIVACY.mdを読む
  When 「データの保存場所」セクションを確認する
  Then 「OPFS (Origin Private File System) 上のSQLite DB」と記載されている
  And 「Chrome ローカルストレージ」の旧記載は存在しない

Scenario: データ保持ポリシーが明記されている
  Given プライバシーポリシーの「データ保持」セクション
  When ユーザーが保持期間を確認する
  Then 「90日または1000件（先に到達した方）」と明記されている
  And 自動クリーンアップの仕組みが説明されている

Scenario: プライバシー同意のダークパターンが排除される
  Given ユーザーがプライバシー同意モーダルを表示する
  When 「拒否」ボタンをクリックする
  Then モーダルが閉じられ、再表示されない
  And 拡張機能が制限モードで起動する
  And 3回目の拒否でpermanently dismissされる
```

## 受け入れ基準
- [ ] `softDelete()`を`hardDelete()`に変更（物理DELETE）
- [ ] `clearAll()`に`PRAGMA wal_checkpoint(TRUNCATE)`を追加
- [ ] `exportDb()`で`is_deleted=1`のフィルタリングを削除（物理削除済みのため不要）
- [ ] PRIVACY.mdの「データの保存場所」を「OPFS上のSQLite DB」に更新
- [ ] PRIVACY.mdにデータ保持ポリシー（90日/1000件）を明記
- [ ] PRIVACY.mdの更新履歴にSQLite移行を記録
- [ ] `privacyConsentController.ts`のループ再表示を修正
- [ ] 拒否時は制限モードで起動する設計に変更
- [ ] オブザーバビリティ: `obsidianSyncService.sync()`のAPIキー検証強化

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 削除操作→物理DELETEの確認
- 「Delete All Data」→全データ消去の確認

### 統合テスト
- `hardDelete()`→FTS5トリガーの連携
- `clearAll()`→WAL checkpointの連携

### 単体テスト
- `hardDelete()`の動作確認
- CHECK制約との整合性
- プライバシー同意の拒否→制限モード遷移

## 実装アプローチ
- **Outside-In**: E2Eテスト（削除シナリオ）→ 統合テスト（FTS5連携）→ 単体テスト（物理DELETE）
- **Red-Green-Refactor**: 各テストが失敗することを確認してから実装
- **リファクタリング**: グリーン後にプライバシーポリシー文面の改善

## 見積もり
5 ポイント（小規模）

## 技術的考慮事項
- 依存関係: PBI-01（CHECK制約）と統合すると効果的
- テスタビリティ: モック不要（実際のSQLiteでテスト）
- 非機能要件: 削除性能（1000件を1秒以内）、GDPR準拠

## 実装者向け注記

### 現状コードの確認
```bash
# softDeleteの実装を確認
grep -n "softDelete" src/offscreen/sqlite.ts

# PRIVACY.mdの保存場所セクションを確認
grep -n "Chrome.*ストレージ\|local storage" docs/PRIVACY.md

# プライバシー同意コントローラーを確認
grep -n "privacyConsentController" src/popup/ -r
```

### 実装手順
1. `src/offscreen/sqlite.ts`の`softDelete()`を`hardDelete()`に変更（`DELETE FROM`）
2. `clearAll()`に`PRAGMA wal_checkpoint(TRUNCATE)`を追加
3. `docs/PRIVACY.md`を更新（OPFS/SQLite、保持ポリシー、更新履歴）
4. `src/popup/privacyConsentController.ts`のループ再表示を修正
5. `src/background/obsidianSyncService.ts`のAPIキー検証を強化

### 落とし穴
- `hardDelete()`に変更すると、誤削除時の復元が不可能になる → UIで確認ダイアログを強化
- `clearAll()`後にWALファイルを解放しないとディスク容量が解放されない
- プライバシー同意の「拒否」時の制限モードで、どの機能を有効/無効にするかの設計が必要

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（PRIVACY.md）
