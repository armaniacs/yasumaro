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
- [x] `softDelete()`を`hardDelete()`に変更（物理DELETE）
- [x] `clearAll()`に`PRAGMA wal_checkpoint(TRUNCATE)`を追加
- [x] `exportDb()`で`is_deleted=1`のフィルタリングを削除（物理削除により不要）
- [x] PRIVACY.mdの「データの保存場所」を「OPFS上のSQLite DB」に更新
- [x] PRIVACY.mdにデータ保持ポリシー（90日/1000件）を明記
- [x] PRIVACY.mdの更新履歴にSQLite移行を記録
- [x] `privacyConsentController.ts`のループ再表示を修正（3回拒否でpermanently dismiss）
- [x] 拒否時は制限モードで起動する設計に変更（`isRecordingAllowed()` in service-worker.ts）
- [x] オブザーバビリティ: `obsidianSyncService.isConfigured()`のAPIキー検証強化（16文字未満・非string → false）

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

### 実装状況（2026-06-11 時点）

> **ジュニア開発者向け**: このセクションは「何が既に実装されていて、何が残っているか」をまとめたものです。

#### 実装済み（コード確認済み）

| 受け入れ基準 | 場所 | 状態 |
|------------|------|------|
| hardDelete()（物理DELETE） | `src/offscreen/sqlite.ts` + `src/offscreen/storageFallback.ts` L221 | ✅ 実装済み |
| clearAll()にPRAGMA wal_checkpoint(TRUNCATE) | `src/offscreen/sqlite.ts` L697 | ✅ 実装済み |
| PRIVACY.md OPFS/SQLite記載 | `docs/PRIVACY.md` L36 | ✅ 更新済み |
| PRIVACY.md データ保持ポリシー（90日/1000件） | `docs/PRIVACY.md` L39, L190 | ✅ 更新済み |
| PRIVACY.md 更新履歴 | `docs/PRIVACY.md` L6 | ✅ 更新済み |
| プライバシー同意コントローラー（3回拒否でpermanently dismiss） | `src/popup/privacyConsentController.ts` | ✅ 実装済み |

#### 残タスク（オーナー解答済み）

1. **`exportDb()` 内の `is_deleted` フィルタリング確認**
   - 物理削除への移行後、`exportDb()` で `WHERE is_deleted=0` のようなフィルタが残っていれば削除してよい
   - 確認コマンド: `grep -n "is_deleted" src/offscreen/sqlite.ts`

2. **プライバシー同意「拒否」時の制限モードを実装する** ← **オーナー決定: 実装必須**

   **決定内容**: 以下の3機能を全て無効化する
   - AIサマリー生成を無効化
   - Obsidian への自動保存を無効化
   - SQLiteへのローカル保存も無効化（記録停止）

   **実装方針**:
   - `chrome.storage.local` に `privacyConsent: 'denied'` を保存（拒否時）
   - `src/background/service-worker.ts` の記録処理エントリーポイントで `privacyConsent` を確認し、`'denied'` なら早期リターン
   - 確認すべき箇所: コンテンツ抽出→AI要約→SQLite保存→Obsidian保存の全パイプライン

   **実装箇所のイメージ**:
   ```typescript
   // service-worker.ts の記録ロジック開始部分
   const consent = await getConsentStatus(); // chrome.storage.local から取得
   if (consent === 'denied') {
     return; // 全パイプラインをスキップ
   }
   ```

   **現状の `privacyConsentController.ts` との連携**:
   - 現在: 3回拒否でモーダルが出なくなるだけ
   - 追加実装: 拒否ステータスを service-worker.ts 側でも読んで記録を止める
   - `getConsentStatus()` は既存の `privacyConsentController.ts` 内か `storage.ts` にユーティリティ関数として追加する

3. **`obsidianSyncService.ts` のAPIキー検証強化**
   - 受け入れ基準に含まれているが実装状況未確認
   - 確認コマンド: `grep -n "apiKey\|validate" src/background/obsidianSyncService.ts | head -20`

#### 設計上の意思決定

**hardDelete vs softDelete: なぜ物理削除を選んだか？**
GDPR Article 17「忘れられる権利」では、ユーザーが削除を要求したデータは完全に消去する義務がある。`is_deleted=1` のsoftDeleteでは、エクスポートや管理者ツール経由でデータが見えてしまうリスクがある。物理DELETEに変更した。

**誤削除リカバリができなくなるトレードオフ**
物理削除を採用した結果、「やっぱり消したくなかった」ケースへの対応は不可能になった。これは意図した妥協点（GDPR準拠を優先）。UIで削除前に「この操作は元に戻せません」の確認ダイアログを表示することで対応する。

### 実装手順
1. `src/offscreen/sqlite.ts`の`softDelete()`を`hardDelete()`に変更（`DELETE FROM`）— **実装済み**
2. `clearAll()`に`PRAGMA wal_checkpoint(TRUNCATE)`を追加 — **実装済み**
3. `docs/PRIVACY.md`を更新（OPFS/SQLite、保持ポリシー、更新履歴） — **実装済み**
4. `src/popup/privacyConsentController.ts`のループ再表示を修正 — **実装済み（制限モードの動作は要確認）**
5. `src/background/obsidianSyncService.ts`のAPIキー検証を強化 — **要確認**

### 落とし穴
- `hardDelete()`に変更すると、誤削除時の復元が不可能になる → UIで確認ダイアログを強化（現状ダイアログがあるか確認すること）
- `clearAll()`後にWALファイルを解放しないとディスク容量が解放されない → `PRAGMA wal_checkpoint(TRUNCATE)` で対応済み
- プライバシー同意の「拒否」時の制限モードで、どの機能を有効/無効にするかの設計が必要 → `questions-for-owner.md` 参照

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（obsidianSyncService APIキー検証テスト追加済み）
- [x] テストカバレッジが基準を満たす（unit test 追加済み）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み（PRIVACY.md）
